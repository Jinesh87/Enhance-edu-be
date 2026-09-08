import crypto from "crypto";
import type OpenAI from "openai";
import {
  CHAT_MODEL,
  createChatCompletion,
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
  ADMIN_AI_TOOL_DEFINITIONS,
  executeAdminAiTool,
  inferModeFromTools,
} from "./tools.js";

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
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    status: message.status,
    mode: message.mode,
    sources: message.sources,
    createdAt: message.createdAt.toISOString(),
  };
}

function mergeSources(parts: AdminAiSource[]): AdminAiSource[] {
  const seen = new Set<string>();
  const out: AdminAiSource[] = [];
  for (const source of parts) {
    const key = `${source.kind}|${source.label}|${source.detail ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }
  return out.slice(0, 12);
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
      { role: "system", content: ADMIN_AI_SYSTEM_PROMPT },
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
            );
            collectedSources.push(...result.sources);
            if (result.documentIds?.length) {
              documentIds.push(...result.documentIds);
            }
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify(result.data),
            });
          } catch (error) {
            const message =
              error instanceof AppError && error.code === "ADMIN_AI_MODULE_FORBIDDEN"
                ? "You do not have permission to access this information."
                : "I could not find authorized data for that request.";
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify({ error: message }),
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
}

export const adminAiService = new AdminAiService();
