import crypto from "crypto";
import type OpenAI from "openai";
import {
  CHAT_MODEL,
  createChatCompletion,
  streamChatCompletion,
} from "../../../common/ai/openai-client.js";
import { AppError } from "../../../common/errors/AppError.js";
import { AppDataSource } from "../../../config/data-source.js";
import { env } from "../../../config/env.js";
import {
  AdminAiMessage,
  type AdminAiMode,
  type AdminAiSource,
} from "../../../entities/AdminAiMessage.js";
import { AdminAiThread } from "../../../entities/AdminAiThread.js";
import { writeAdminAiAudit } from "./audit.js";
import {
  assertAdminAiEnabled,
  resolveAdminAiActor,
  type AdminAiActor,
} from "./authorization.js";
import { assertAdminAiRateLimit } from "./rate-limit.js";
import { previewForSidebar, sanitizeAdminAiText } from "./sanitize.js";
import { ADMIN_AI_SYSTEM_PROMPT } from "./system-prompt.js";
import {
  formatAdminAiMemoryPromptBlock,
  adminAiMemoryService,
} from "./memory.js";
import { adminAiReportService } from "./reports/report.service.js";
import { communicationDraftService } from "./communications/communication-draft.service.js";
import {
  ADMIN_AI_TOOL_DEFINITIONS,
  executeAdminAiTool,
  inferModeFromTools,
} from "./tools.js";
import { actionSource } from "./tool-helpers.js";

const HISTORY_LIMIT = 12;
const MAX_TOOL_ROUNDS = 3;
const MAX_COMPLETION_TOKENS = 1200;

function toThreadDto(thread: AdminAiThread, preview?: string | null) {
  return {
    id: thread.id,
    title: thread.title,
    preview: preview ?? null,
    lastMessageAt: thread.lastMessageAt?.toISOString() ?? null,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
  };
}

function toMessageDto(message: AdminAiMessage) {
  const allSources = message.sources ?? [];
  const actions = allSources
    .filter(
      (source) =>
        source.kind === "action" &&
        (source.openPage ||
          source.downloadReport ||
          source.generateReport ||
          source.adjustReport ||
          source.confirmSend),
    )
    .map(
      (source) =>
        source.openPage ??
        source.downloadReport ??
        source.generateReport ??
        source.adjustReport ??
        source.confirmSend!,
    )
    .slice(0, 8);
  const sources = allSources.filter((source) => source.kind !== "action");

  return {
    id: message.id,
    role: message.role,
    content: message.content,
    status: message.status,
    mode: message.mode,
    sources: sources.length ? sources : null,
    actions: actions.length ? actions : null,
    createdAt: message.createdAt.toISOString(),
  };
}

function mergeSources(parts: AdminAiSource[]): AdminAiSource[] {
  const seen = new Set<string>();
  const out: AdminAiSource[] = [];
  for (const source of parts) {
    const key =
      source.kind === "action" && source.downloadReport
        ? `action|download|${source.downloadReport.reportId}|${source.downloadReport.label}`
        : source.kind === "action" && source.generateReport
          ? `action|generate|${source.generateReport.draftId}|${source.generateReport.label}`
          : source.kind === "action" && source.adjustReport
            ? `action|adjust|${source.adjustReport.draftId}|${source.adjustReport.label}`
            : source.kind === "action" && source.confirmSend
              ? `action|confirmSend|${source.confirmSend.draftId}|${source.confirmSend.label}`
              : source.kind === "action" && source.openPage
              ? `action|${source.openPage.resource}|${source.openPage.id ?? ""}|${JSON.stringify(source.openPage.filters ?? {})}|${source.openPage.label}`
              : `${source.kind}|${source.label}|${source.detail ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }
  return out.slice(0, 20);
}

function toolErrorMessage(error: unknown): string {
  if (!(error instanceof AppError)) {
    return "I could not find authorized data for that request.";
  }
  if (error.code === "ADMIN_AI_MODULE_FORBIDDEN") {
    return "You do not have permission to access this information.";
  }
  if (error.code.startsWith("ADMIN_AI_MEMORY_")) {
    return error.message;
  }
  if (error.code.startsWith("ADMIN_AI_REPORT_")) {
    return error.message;
  }
  if (error.code.startsWith("ADMIN_AI_COMM_")) {
    return error.message;
  }
  return "I could not find authorized data for that request.";
}

export class AdminAiService {
  private readonly threads = AppDataSource.getRepository(AdminAiThread);
  private readonly messages = AppDataSource.getRepository(AdminAiMessage);

  private async requireActor(userId: string): Promise<AdminAiActor> {
    assertAdminAiEnabled();
    return resolveAdminAiActor(userId);
  }

  private async requireOwnedThread(actorId: string, threadId: string) {
    const thread = await this.threads.findOne({
      where: { id: threadId, ownerUserId: actorId },
    });
    if (!thread) {
      throw new AppError(404, "Chat not found", "ADMIN_AI_THREAD_NOT_FOUND");
    }
    return thread;
  }

  private async buildSystemContent(actor: AdminAiActor): Promise<string> {
    const memories = await adminAiMemoryService.listForPrompt(actor);
    const memoryBlock = formatAdminAiMemoryPromptBlock(memories);
    if (!memoryBlock) return ADMIN_AI_SYSTEM_PROMPT;
    return `${ADMIN_AI_SYSTEM_PROMPT}\n\n${memoryBlock}`;
  }

  async listMemories(userId: string) {
    const actor = await this.requireActor(userId);
    return adminAiMemoryService.listForUser(actor);
  }

  async deleteMemory(userId: string, memoryId: string) {
    const actor = await this.requireActor(userId);
    return adminAiMemoryService.delete(actor, memoryId);
  }

  async downloadReport(
    userId: string,
    reportId: string,
    res: import("express").Response,
  ) {
    const actor = await this.requireActor(userId);
    return adminAiReportService.downloadForOwner(actor, reportId, res);
  }

  async confirmGenerateReport(userId: string, draftId: string) {
    const actor = await this.requireActor(userId);
    const result = await adminAiReportService.confirmGenerate(actor, draftId);
    return {
      reportId: result.reportId,
      title: result.title,
      fileName: result.fileName,
      rowCount: result.rowCount,
      truncated: result.truncated,
    };
  }

  async getCommunicationDraft(userId: string, draftId: string) {
    const actor = await this.requireActor(userId);
    return communicationDraftService.get(actor, draftId);
  }

  async listCommunicationRecipients(userId: string, draftId: string) {
    const actor = await this.requireActor(userId);
    return communicationDraftService.listRecipients(actor, draftId);
  }

  async updateCommunicationDraft(
    userId: string,
    draftId: string,
    input: {
      subject?: string;
      body?: string;
      refreshAudience?: boolean;
      audienceType?: string;
      roles?: string[];
      groups?: string[];
      yearLevel?: string | null;
      term?: string | null;
      subjectFilter?: string | null;
      className?: string | null;
      date?: string | null;
      nameQuery?: string | null;
      userIds?: string[];
      selectedUserIds?: string[];
      recipientOf?: string;
      assessmentQuery?: string | null;
      enquiryStage?: string | null;
      status?: string | null;
      label?: string | null;
      ambiguous?: boolean;
      confirmed?: boolean;
    },
  ) {
    const actor = await this.requireActor(userId);
    const hasAudiencePatch = Boolean(
      input.audienceType ||
        input.roles ||
        input.groups ||
        input.recipientOf ||
        input.confirmed !== undefined ||
        input.yearLevel ||
        input.term ||
        input.subjectFilter ||
        input.className ||
        input.date ||
        input.nameQuery ||
        input.userIds ||
        input.assessmentQuery ||
        input.enquiryStage ||
        input.status ||
        input.label ||
        input.ambiguous !== undefined,
    );
    const audience = hasAudiencePatch
      ? {
          type: input.audienceType,
          roles: input.roles,
          groups: input.groups,
          yearLevel: input.yearLevel,
          term: input.term,
          subject: input.subjectFilter,
          className: input.className,
          date: input.date,
          nameQuery: input.nameQuery,
          userIds: input.userIds,
          recipientOf: input.recipientOf,
          assessmentQuery: input.assessmentQuery,
          enquiryStage: input.enquiryStage,
          status: input.status,
          label: input.label,
          ambiguous: input.ambiguous,
          confirmed: input.confirmed,
          options: null,
        }
      : undefined;
    return communicationDraftService.update(actor, draftId, {
      subject: input.subject,
      body: input.body,
      refreshAudience: input.refreshAudience,
      audience,
      selectedUserIds: input.selectedUserIds,
    });
  }

  async confirmSendCommunication(
    userId: string,
    draftId: string,
    input: {
      password?: string;
      subject?: string;
      body?: string;
      retryFailedOnly?: boolean;
      selectedUserIds?: string[];
      attachments?: Array<{
        filename?: string;
        contentBase64?: string;
        mimeType?: string | null;
      }>;
    },
  ) {
    const actor = await this.requireActor(userId);
    return communicationDraftService.confirmSend(actor, draftId, input);
  }

  async listThreads(userId: string, cursor?: string | null) {
    const actor = await this.requireActor(userId);
    const take = 30;

    const qb = this.threads
      .createQueryBuilder("thread")
      .where("thread.ownerUserId = :ownerUserId", { ownerUserId: actor.id })
      .andWhere("thread.deletedAt IS NULL")
      .orderBy("thread.updatedAt", "DESC")
      .addOrderBy("thread.id", "DESC")
      .take(take + 1);

    if (cursor) {
      const cursorThread = await this.threads.findOne({
        where: { id: cursor, ownerUserId: actor.id },
      });
      if (cursorThread) {
        qb.andWhere(
          "(thread.updatedAt < :cursorUpdatedAt OR (thread.updatedAt = :cursorUpdatedAt AND thread.id < :cursorId))",
          {
            cursorUpdatedAt: cursorThread.updatedAt,
            cursorId: cursorThread.id,
          },
        );
      }
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;

    const previews = new Map<string, string>();
    if (page.length > 0) {
      const latest = await this.messages
        .createQueryBuilder("message")
        .distinctOn(["message.threadId"])
        .where("message.threadId IN (:...ids)", {
          ids: page.map((thread) => thread.id),
        })
        .orderBy("message.threadId")
        .addOrderBy("message.createdAt", "DESC")
        .getMany();
      for (const message of latest) {
        previews.set(message.threadId, previewForSidebar(message.content));
      }
    }

    return {
      threads: page.map((thread) =>
        toThreadDto(thread, previews.get(thread.id) ?? null),
      ),
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    };
  }

  async createThread(userId: string) {
    const actor = await this.requireActor(userId);
    const thread = this.threads.create({
      ownerUserId: actor.id,
      title: null,
      lastMessageAt: null,
    });
    await this.threads.save(thread);
    return { thread: toThreadDto(thread), messages: [] as ReturnType<typeof toMessageDto>[] };
  }

  async getThread(userId: string, threadId: string) {
    const actor = await this.requireActor(userId);
    const thread = await this.requireOwnedThread(actor.id, threadId);
    const messages = await this.messages.find({
      where: { threadId: thread.id },
      order: { createdAt: "ASC" },
      take: 200,
    });
    return {
      thread: toThreadDto(thread),
      messages: messages.map(toMessageDto),
    };
  }

  async deleteThread(userId: string, threadId: string) {
    const actor = await this.requireActor(userId);
    const thread = await this.requireOwnedThread(actor.id, threadId);
    await this.threads.softRemove(thread);
    return { deletedId: threadId };
  }

  async sendMessage(
    userId: string,
    input: { content: string; threadId?: string | null },
  ) {
    const requestId = crypto.randomUUID();
    const actor = await this.requireActor(userId);
    await assertAdminAiRateLimit(actor.id);

    const content = sanitizeAdminAiText(
      input.content,
      env.ADMIN_AI_MAX_MESSAGE_CHARS,
    );
    if (!content) {
      throw new AppError(400, "Message is required", "VALIDATION_ERROR");
    }

    let thread: AdminAiThread;
    if (input.threadId) {
      thread = await this.requireOwnedThread(actor.id, input.threadId);
    } else {
      thread = this.threads.create({
        ownerUserId: actor.id,
        title: content.slice(0, 80),
        lastMessageAt: null,
      });
      await this.threads.save(thread);
    }

    if (!thread.title) {
      thread.title = content.slice(0, 80);
      await this.threads.save(thread);
    }

    const userMessage = this.messages.create({
      threadId: thread.id,
      role: "user",
      content,
      status: "COMPLETE",
      mode: null,
      sources: null,
    });
    await this.messages.save(userMessage);

    await writeAdminAiAudit({
      requestId,
      actor,
      conversationId: thread.id,
      eventType: "AI_REQUEST_CREATED",
      resultStatus: "started",
    });

    const history = await this.messages.find({
      where: { threadId: thread.id },
      order: { createdAt: "DESC" },
      take: HISTORY_LIMIT,
    });
    history.reverse();

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: await this.buildSystemContent(actor) },
      ...history
        .filter(
          (msg) =>
            msg.id !== userMessage.id && msg.status === "COMPLETE",
        )
        .map((msg) => ({
          role:
            msg.role === "assistant"
              ? ("assistant" as const)
              : ("user" as const),
          content: msg.content,
        })),
      { role: "user", content },
    ];

    const toolNames: string[] = [];
    const collectedSources: AdminAiSource[] = [];
    const documentIds: string[] = [];

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        const completion = await createChatCompletion(
          {
            model: CHAT_MODEL,
            temperature: 0.2,
            max_tokens: MAX_COMPLETION_TOKENS,
            messages,
            tools: ADMIN_AI_TOOL_DEFINITIONS,
            tool_choice: "auto",
          },
          {
            feature: "admin_ai_chat",
            userId: actor.id,
            metadata: {
              requestId,
              threadId: thread.id,
              round,
            },
          },
        );

        const choice = completion.choices[0]?.message;
        if (!choice) {
          throw new AppError(
            503,
            "Admin AI is temporarily unavailable.",
            "ADMIN_AI_UNAVAILABLE",
          );
        }

        const toolCalls = choice.tool_calls ?? [];
        if (toolCalls.length === 0) {
          const replyText =
            choice.content?.trim() ||
            "I could not find authorized data for that request.";
          const mode = inferModeFromTools(toolNames) as AdminAiMode;
          const sources = mergeSources(collectedSources);

          const assistantMessage = this.messages.create({
            threadId: thread.id,
            role: "assistant",
            content: replyText,
            status: "COMPLETE",
            mode,
            sources: sources.length ? sources : null,
          });
          await this.messages.save(assistantMessage);

          thread.lastMessageAt = new Date();
          thread.updatedAt = new Date();
          await this.threads.save(thread);

          await writeAdminAiAudit({
            requestId,
            actor,
            conversationId: thread.id,
            eventType: "AI_REQUEST_COMPLETED",
            mode,
            toolNames,
            scopeMetadata: { sourceCount: sources.length },
            documentIds: documentIds.length ? documentIds : null,
            resultStatus: "success",
          });

          return {
            thread: toThreadDto(thread, previewForSidebar(replyText)),
            userMessage: toMessageDto(userMessage),
            assistantMessage: toMessageDto(assistantMessage),
            requestId,
          };
        }

        messages.push({
          role: "assistant",
          content: choice.content ?? null,
          tool_calls: toolCalls,
        });

        for (const call of toolCalls) {
          if (call.type !== "function") continue;
          const name = call.function.name;
          toolNames.push(name);
          try {
            const result = await executeAdminAiTool(
              actor,
              name,
              call.function.arguments,
              { userMessage: input.content },
            );
            collectedSources.push(...result.sources);
            if (result.actions?.length) {
              collectedSources.push(
                ...result.actions.map((action) => actionSource(action)),
              );
            }
            if (result.documentIds?.length) {
              documentIds.push(...result.documentIds);
            }
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify(result.data),
            });
          } catch (error) {
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify({ error: toolErrorMessage(error) }),
            });
          }
        }
      }

      throw new AppError(
        503,
        "Admin AI is temporarily unavailable.",
        "ADMIN_AI_TOOL_LIMIT",
      );
    } catch (error) {
      try {
        userMessage.status = "FAILED";
        await this.messages.save(userMessage);
      } catch {
        /* best-effort status update */
      }

      await writeAdminAiAudit({
        requestId,
        actor,
        conversationId: thread.id,
        eventType: "AI_REQUEST_FAILED",
        toolNames,
        resultStatus: "failure",
        errorCode:
          error instanceof AppError ? error.code : "ADMIN_AI_UNAVAILABLE",
      });

      if (error instanceof AppError) throw error;
      throw new AppError(
        503,
        "Admin AI is temporarily unavailable.",
        "ADMIN_AI_UNAVAILABLE",
      );
    }
  }

  /**
   * Same orchestration as sendMessage, but streams the final answer over SSE.
   * Tool rounds stream internally; content deltas are only emitted for the
   * final assistant text (when there are no tool_calls).
   */
  async sendMessageStream(
    userId: string,
    input: { content: string; threadId?: string | null },
    emit: (event: string, data: unknown) => void,
    signal?: AbortSignal,
  ) {
    const requestId = crypto.randomUUID();
    const actor = await this.requireActor(userId);
    await assertAdminAiRateLimit(actor.id);

    const content = sanitizeAdminAiText(
      input.content,
      env.ADMIN_AI_MAX_MESSAGE_CHARS,
    );
    if (!content) {
      throw new AppError(400, "Message is required", "VALIDATION_ERROR");
    }

    let thread: AdminAiThread;
    if (input.threadId) {
      thread = await this.requireOwnedThread(actor.id, input.threadId);
    } else {
      thread = this.threads.create({
        ownerUserId: actor.id,
        title: content.slice(0, 80),
        lastMessageAt: null,
      });
      await this.threads.save(thread);
    }

    if (!thread.title) {
      thread.title = content.slice(0, 80);
      await this.threads.save(thread);
    }

    const userMessage = this.messages.create({
      threadId: thread.id,
      role: "user",
      content,
      status: "COMPLETE",
      mode: null,
      sources: null,
    });
    await this.messages.save(userMessage);

    await writeAdminAiAudit({
      requestId,
      actor,
      conversationId: thread.id,
      eventType: "AI_REQUEST_CREATED",
      resultStatus: "started",
    });

    emit("meta", {
      requestId,
      thread: toThreadDto(thread),
      userMessage: toMessageDto(userMessage),
    });
    emit("status", { phase: "thinking" });

    const history = await this.messages.find({
      where: { threadId: thread.id },
      order: { createdAt: "DESC" },
      take: HISTORY_LIMIT,
    });
    history.reverse();

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: await this.buildSystemContent(actor) },
      ...history
        .filter(
          (msg) =>
            msg.id !== userMessage.id && msg.status === "COMPLETE",
        )
        .map((msg) => ({
          role:
            msg.role === "assistant"
              ? ("assistant" as const)
              : ("user" as const),
          content: msg.content,
        })),
      { role: "user", content },
    ];

    const toolNames: string[] = [];
    const collectedSources: AdminAiSource[] = [];
    const documentIds: string[] = [];

    const isAborted = () => Boolean(signal?.aborted);

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        if (isAborted()) {
          const abortError = new Error("Aborted");
          abortError.name = "AbortError";
          throw abortError;
        }

        let emittedText = false;
        const streamed = await streamChatCompletion(
          {
            model: CHAT_MODEL,
            temperature: 0.2,
            max_tokens: MAX_COMPLETION_TOKENS,
            messages,
            tools: ADMIN_AI_TOOL_DEFINITIONS,
            tool_choice: "auto",
          },
          {
            feature: "admin_ai_chat",
            userId: actor.id,
            metadata: {
              requestId,
              threadId: thread.id,
              round,
              streamed: true,
            },
          },
          {
            signal,
            onDelta: (text) => {
              emittedText = true;
              emit("delta", { text });
            },
          },
        );

        const toolCalls = streamed.toolCalls;
        if (toolCalls.length === 0) {
          const replyText =
            streamed.content.trim() ||
            "I could not find authorized data for that request.";
          const mode = inferModeFromTools(toolNames) as AdminAiMode;
          const sources = mergeSources(collectedSources);

          const assistantMessage = this.messages.create({
            threadId: thread.id,
            role: "assistant",
            content: replyText,
            status: "COMPLETE",
            mode,
            sources: sources.length ? sources : null,
          });
          await this.messages.save(assistantMessage);

          thread.lastMessageAt = new Date();
          thread.updatedAt = new Date();
          await this.threads.save(thread);

          await writeAdminAiAudit({
            requestId,
            actor,
            conversationId: thread.id,
            eventType: "AI_REQUEST_COMPLETED",
            mode,
            toolNames,
            scopeMetadata: { sourceCount: sources.length },
            documentIds: documentIds.length ? documentIds : null,
            resultStatus: "success",
          });

          emit("done", {
            requestId,
            thread: toThreadDto(thread, previewForSidebar(replyText)),
            userMessage: toMessageDto(userMessage),
            assistantMessage: toMessageDto(assistantMessage),
          });
          return;
        }

        if (emittedText) {
          emit("clear", {});
        }

        const names = toolCalls
          .filter((call) => call.type === "function")
          .map((call) => call.function.name);
        emit("status", { phase: "tools", tools: names });

        messages.push({
          role: "assistant",
          content: streamed.content || null,
          tool_calls: toolCalls,
        });

        for (const call of toolCalls) {
          if (call.type !== "function") continue;
          const name = call.function.name;
          toolNames.push(name);
          try {
            const result = await executeAdminAiTool(
              actor,
              name,
              call.function.arguments,
              { userMessage: input.content },
            );
            collectedSources.push(...result.sources);
            if (result.actions?.length) {
              collectedSources.push(
                ...result.actions.map((action) => actionSource(action)),
              );
            }
            if (result.documentIds?.length) {
              documentIds.push(...result.documentIds);
            }
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify(result.data),
            });
          } catch (error) {
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify({ error: toolErrorMessage(error) }),
            });
          }
        }
      }

      throw new AppError(
        503,
        "Admin AI is temporarily unavailable.",
        "ADMIN_AI_TOOL_LIMIT",
      );
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") {
        try {
          userMessage.status = "FAILED";
          await this.messages.save(userMessage);
        } catch {
          /* best-effort */
        }
        await writeAdminAiAudit({
          requestId,
          actor,
          conversationId: thread.id,
          eventType: "AI_REQUEST_FAILED",
          toolNames,
          resultStatus: "failure",
          errorCode: "ADMIN_AI_ABORTED",
        });
        return;
      }

      try {
        userMessage.status = "FAILED";
        await this.messages.save(userMessage);
      } catch {
        /* best-effort status update */
      }

      await writeAdminAiAudit({
        requestId,
        actor,
        conversationId: thread.id,
        eventType: "AI_REQUEST_FAILED",
        toolNames,
        resultStatus: "failure",
        errorCode:
          error instanceof AppError ? error.code : "ADMIN_AI_UNAVAILABLE",
      });

      emit("error", {
        message:
          error instanceof AppError
            ? error.message
            : "Admin AI is temporarily unavailable.",
        code:
          error instanceof AppError ? error.code : "ADMIN_AI_UNAVAILABLE",
      });
    }
  }
}

export const adminAiService = new AdminAiService();
