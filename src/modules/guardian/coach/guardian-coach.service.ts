import type OpenAI from "openai";
import {
  CHAT_MODEL,
  createChatCompletion,
  embedText,
} from "../../../common/ai/openai-client.js";
import { AppError } from "../../../common/errors/AppError.js";
import { AppDataSource } from "../../../config/data-source.js";
import { logger } from "../../../config/logger.js";
import {
  GuardianCoachMessage,
  GuardianCoachThread,
} from "../../../entities/index.js";
import { studentKnowledgeIngestService } from "../../coach/student-knowledge-ingest.service.js";
import { retrieveStudentKnowledgeChunks } from "../../coach/student-knowledge-store.js";
import {
  executeGuardianCoachTool,
  GUARDIAN_COACH_TOOL_DEFINITIONS,
  type GuardianCoachSource,
} from "./guardian-coach.tools.js";

const HISTORY_LIMIT = 12;
const MAX_TOOL_ROUNDS = 4;
const MAX_COMPLETION_TOKENS = 1400;
const RETRIEVAL_LIMIT = 10;

const SYSTEM_PROMPT = `You are a helpful parent/guardian assistant for Enhance Education.

Primary knowledge source:
- A "Student knowledge" block is injected from the child's vectorized records (enrolment, attendance, assessments, homework, rolling summary, timetable snapshot).
- Answer attendance, marks, homework, overall performance, and enrolment questions FROM that block.
- Do not invent facts that are not in the knowledge block or tool results.

Tools (use sparingly):
- resolveChild — when Active child is unknown or parent switches child.
- getChildUpcoming — live today/this week schedule (prefer over stale timetable chunk for "what's today").
- getHolidays — school holidays.
- refreshStudentKnowledge — only if parent says data looks wrong/outdated.

Rules:
- If Active child studentId is set, reuse it; do not claim you cannot retrieve data that appears in the knowledge block.
- Never contradict the knowledge block (e.g. do not say attendance is unavailable if the block includes attendance %).
- If knowledge says the child has no login, explain that enrolment is available but academics need a student login.
- Be concise and factual.
- Today's date (UTC) is provided below.`;

function toMessageDto(message: GuardianCoachMessage) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    sources: message.sources,
    createdAt: message.createdAt.toISOString(),
  };
}

function toThreadDto(thread: GuardianCoachThread) {
  return {
    id: thread.id,
    title: thread.title,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
  };
}

function mergeSources(parts: GuardianCoachSource[]): GuardianCoachSource[] {
  const seen = new Set<string>();
  const out: GuardianCoachSource[] = [];
  for (const source of parts) {
    const key = `${source.label}|${source.detail ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }
  return out.slice(0, 12);
}

async function buildKnowledgeContext(
  studentEntityId: string,
  question: string,
  actorUserId: string,
): Promise<{ block: string; sources: GuardianCoachSource[] }> {
  try {
    await studentKnowledgeIngestService.ensureIndexed(studentEntityId, {
      actorUserId,
    });
  } catch (error) {
    logger.warn(
      { err: error, studentEntityId },
      "Failed to ensure student knowledge index",
    );
  }

  try {
    const embedding = await embedText(question, {
      feature: "guardian_coach_retrieve",
      userId: actorUserId,
      metadata: { studentEntityId },
    });
    const hits = await retrieveStudentKnowledgeChunks({
      studentId: studentEntityId,
      embedding,
      limit: RETRIEVAL_LIMIT,
    });

    if (hits.length === 0) {
      return {
        block:
          "Student knowledge: no indexed records yet for this child. Enrolment-only or login may be missing. You may call refreshStudentKnowledge.",
        sources: [],
      };
    }

    const block = [
      "Student knowledge (retrieved excerpts — answer from these):",
      ...hits.map(
        (hit, index) =>
          `[${index + 1}] (${hit.sourceType}${hit.occurredOn ? ` @ ${hit.occurredOn}` : ""}) ${hit.content}`,
      ),
    ].join("\n");

    const sources: GuardianCoachSource[] = hits.slice(0, 8).map((hit) => ({
      kind: "document",
      label: hit.sourceLabel || hit.sourceType,
      detail: hit.occurredOn ?? hit.sourceId,
    }));

    return { block, sources };
  } catch (error) {
    logger.warn(
      { err: error, studentEntityId },
      "Student knowledge retrieval failed",
    );
    return {
      block:
        "Student knowledge: retrieval failed. You may call refreshStudentKnowledge or getChildUpcoming for live schedule.",
      sources: [],
    };
  }
}

export class GuardianCoachService {
  private readonly threads = AppDataSource.getRepository(GuardianCoachThread);
  private readonly messages = AppDataSource.getRepository(GuardianCoachMessage);

  private async requireOwnedThread(ownerUserId: string, threadId: string) {
    const thread = await this.threads.findOne({
      where: { id: threadId, ownerUserId },
    });
    if (!thread) {
      throw new AppError(404, "Chat not found", "GUARDIAN_COACH_THREAD_NOT_FOUND");
    }
    return thread;
  }

  async getConversation(userId: string, threadId?: string | null) {
    let thread: GuardianCoachThread | null = null;
    if (threadId) {
      thread = await this.requireOwnedThread(userId, threadId);
    } else {
      thread = await this.threads.findOne({
        where: { ownerUserId: userId },
        order: { updatedAt: "DESC" },
      });
    }

    if (!thread) {
      return { thread: null, messages: [] as ReturnType<typeof toMessageDto>[] };
    }

    const messages = await this.messages.find({
      where: { threadId: thread.id },
      order: { createdAt: "ASC" },
    });

    return {
      thread: toThreadDto(thread),
      messages: messages.map(toMessageDto),
    };
  }

  async listThreads(userId: string) {
    const threads = await this.threads.find({
      where: { ownerUserId: userId },
      order: { updatedAt: "DESC" },
      take: 50,
    });
    return { threads: threads.map(toThreadDto) };
  }

  async createThread(userId: string) {
    const thread = this.threads.create({
      ownerUserId: userId,
      title: null,
      focusedStudentId: null,
      focusedStudentName: null,
    });
    await this.threads.save(thread);
    return {
      thread: toThreadDto(thread),
      messages: [] as ReturnType<typeof toMessageDto>[],
    };
  }

  async deleteThread(userId: string, threadId: string) {
    const thread = await this.requireOwnedThread(userId, threadId);
    await this.threads.remove(thread);

    const next = await this.threads.findOne({
      where: { ownerUserId: userId },
      order: { updatedAt: "DESC" },
    });

    return {
      deletedId: threadId,
      nextThreadId: next?.id ?? null,
    };
  }

  async sendMessage(
    userId: string,
    input: { content: string; threadId?: string | null },
  ) {
    const content = input.content.trim();
    if (!content) {
      throw new AppError(400, "Message is required", "VALIDATION_ERROR");
    }

    let thread: GuardianCoachThread;
    if (input.threadId) {
      thread = await this.requireOwnedThread(userId, input.threadId);
    } else {
      thread = this.threads.create({
        ownerUserId: userId,
        title: content.slice(0, 80),
        focusedStudentId: null,
        focusedStudentName: null,
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
      sources: null,
    });
    await this.messages.save(userMessage);

    const history = await this.messages.find({
      where: { threadId: thread.id },
      order: { createdAt: "DESC" },
      take: HISTORY_LIMIT,
    });
    history.reverse();

    const today = new Date().toISOString().slice(0, 10);
    let focusedStudentId = thread.focusedStudentId;
    let focusedStudentName = thread.focusedStudentName;
    const collectedSources: GuardianCoachSource[] = [];

    let knowledgeBlock =
      "Student knowledge: none loaded yet. Call resolveChild if needed.";
    if (focusedStudentId) {
      const knowledge = await buildKnowledgeContext(
        focusedStudentId,
        content,
        userId,
      );
      knowledgeBlock = knowledge.block;
      collectedSources.push(...knowledge.sources);
    }

    const activeChildLine =
      focusedStudentId && focusedStudentName
        ? `Active child: ${focusedStudentName} (studentId=${focusedStudentId}).`
        : focusedStudentId
          ? `Active child studentId=${focusedStudentId}.`
          : "Active child: none yet. Call resolveChild first.";

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `${SYSTEM_PROMPT}\n\nToday's date (UTC): ${today}\n${activeChildLine}\n\n${knowledgeBlock}`,
      },
      ...history
        .filter((msg) => msg.id !== userMessage.id)
        .map((msg) => ({
          role:
            msg.role === "assistant"
              ? ("assistant" as const)
              : ("user" as const),
          content: msg.content,
        })),
      { role: "user", content },
    ];

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        const completion = await createChatCompletion(
          {
            model: CHAT_MODEL,
            temperature: 0.2,
            max_tokens: MAX_COMPLETION_TOKENS,
            messages,
            tools: GUARDIAN_COACH_TOOL_DEFINITIONS,
            tool_choice: "auto",
          },
          {
            feature: "guardian_coach_chat",
            userId,
            metadata: { threadId: thread.id, round },
          },
        );

        const choice = completion.choices[0]?.message;
        if (!choice) {
          throw new AppError(
            503,
            "Parent assistant is temporarily unavailable.",
            "GUARDIAN_COACH_UNAVAILABLE",
          );
        }

        const toolCalls = choice.tool_calls ?? [];
        if (toolCalls.length === 0) {
          const replyText =
            choice.content?.trim() ||
            "I could not find data for that request.";
          const sources = mergeSources(collectedSources);

          const assistantMessage = this.messages.create({
            threadId: thread.id,
            role: "assistant",
            content: replyText,
            sources: sources.length ? sources : null,
          });
          await this.messages.save(assistantMessage);

          thread.focusedStudentId = focusedStudentId;
          thread.focusedStudentName = focusedStudentName;
          thread.updatedAt = new Date();
          await this.threads.save(thread);

          return {
            thread: toThreadDto(thread),
            userMessage: toMessageDto(userMessage),
            coachMessage: toMessageDto(assistantMessage),
          };
        }

        messages.push({
          role: "assistant",
          content: choice.content ?? null,
          tool_calls: toolCalls,
        });

        let resolvedNewChild = false;

        for (const call of toolCalls) {
          if (call.type !== "function") continue;
          try {
            const result = await executeGuardianCoachTool(
              userId,
              call.function.name,
              call.function.arguments,
              { focusedStudentId },
            );
            collectedSources.push(...result.sources);

            const data = result.data as Record<string, unknown> | null;
            if (
              call.function.name === "resolveChild" &&
              data &&
              data.status === "resolved" &&
              typeof data.studentId === "string"
            ) {
              focusedStudentId = data.studentId;
              const child = data.child as
                | { fullName?: string; preferredName?: string | null }
                | undefined;
              focusedStudentName =
                child?.preferredName || child?.fullName || focusedStudentName;
              resolvedNewChild = true;
            }

            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify(result.data),
            });
          } catch (error) {
            const message =
              error instanceof AppError
                ? error.message
                : "I could not load that information.";
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify({ error: message }),
            });
          }
        }

        if (resolvedNewChild && focusedStudentId) {
          const knowledge = await buildKnowledgeContext(
            focusedStudentId,
            content,
            userId,
          );
          collectedSources.push(...knowledge.sources);
          messages.push({
            role: "system",
            content: `Updated active child ${focusedStudentName ?? focusedStudentId}.\n\n${knowledge.block}`,
          });
        }
      }

      throw new AppError(
        503,
        "Parent assistant is temporarily unavailable.",
        "GUARDIAN_COACH_TOOL_LIMIT",
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        503,
        "Parent assistant is temporarily unavailable.",
        "GUARDIAN_COACH_UNAVAILABLE",
      );
    }
  }
}

export const guardianCoachService = new GuardianCoachService();
