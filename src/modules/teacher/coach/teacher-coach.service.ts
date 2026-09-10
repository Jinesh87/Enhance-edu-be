import type OpenAI from "openai";
import {
  CHAT_MODEL,
  createChatCompletion,
  embedText,
  embeddingToPgVector,
} from "../../../common/ai/openai-client.js";
import { AppError } from "../../../common/errors/AppError.js";
import { AppDataSource } from "../../../config/data-source.js";
import { logger } from "../../../config/logger.js";
import {
  Subject,
  Syllabus,
  TeacherCoachMessage,
  TeacherCoachThread,
} from "../../../entities/index.js";
import {
  cosineSimilarity,
  hasPgVector,
} from "../../coach/embedding-store.js";
import { teacherClassRepository } from "../class/teacher-class.repository.js";
import { teacherClassService } from "../class/teacher-class.service.js";
import {
  executeTeacherCoachTool,
  TEACHER_COACH_TOOL_DEFINITIONS,
  type TeacherCoachSource,
} from "./teacher-coach.tools.js";

const HISTORY_LIMIT = 12;
const MAX_TOOL_ROUNDS = 6;
const MAX_COMPLETION_TOKENS = 1400;
const RETRIEVAL_LIMIT = 8;

const SYSTEM_PROMPT = `You are a helpful teaching assistant for Enhance Education tutors.

You help with:
1) Teaching ops — today's classes, upcoming sessions, PAST/ENDED sessions, attendance (who was present/absent), homework lists, marking queue, holidays, subjects taught.
2) Syllabus / content — explain topics, skills, and suggest revision or homework ideas using the "Syllabus knowledge" block.

Ops tool guidance:
- For previous months / past / ended classes → call listPastSessions (paginated, newest first). It includes attended/absent counts.
- For who was absent/present in a specific class → call getSessionDetail with that sessionId (works for ended sessions too).
- For upcoming / this week / next week → listUpcomingSessions or getTodayOverview. Never use those for past history.
- If the teacher asks about several past classes' absentees, listPastSessions first, then getSessionDetail for the relevant sessionIds.

Rules:
- Only discuss classes/subjects this teacher teaches. Use tools for live ops data; do not invent attendance, marks, or schedules.
- Answer content questions from the Syllabus knowledge block when present. If the block is empty, say syllabus content is not indexed for their subjects yet.
- Be concise and practical. Suggest the tutor open Marking, Homework, or Classes in the app when useful.
- Today's date (UTC) is provided below.`;

type RetrievedChunk = {
  id: string;
  syllabusId: string;
  sourceType: string;
  sourceLabel: string | null;
  content: string;
};

function toMessageDto(message: TeacherCoachMessage) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    sources: message.sources,
    createdAt: message.createdAt.toISOString(),
  };
}

function toThreadDto(thread: TeacherCoachThread) {
  return {
    id: thread.id,
    title: thread.title,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
  };
}

function mergeSources(parts: TeacherCoachSource[]): TeacherCoachSource[] {
  const seen = new Set<string>();
  const out: TeacherCoachSource[] = [];
  for (const source of parts) {
    const key = `${source.label}|${source.detail ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }
  return out.slice(0, 12);
}

export class TeacherCoachService {
  private readonly threads = AppDataSource.getRepository(TeacherCoachThread);
  private readonly messages = AppDataSource.getRepository(TeacherCoachMessage);
  private readonly subjects = AppDataSource.getRepository(Subject);
  private readonly syllabi = AppDataSource.getRepository(Syllabus);

  private async requireOwnedThread(ownerUserId: string, threadId: string) {
    const thread = await this.threads.findOne({
      where: { id: threadId, ownerUserId },
    });
    if (!thread) {
      throw new AppError(404, "Chat not found", "TEACHER_COACH_THREAD_NOT_FOUND");
    }
    return thread;
  }

  private async teacherSyllabusIds(teacherUserId: string): Promise<string[]> {
    const [classes, subjectNames] = await Promise.all([
      teacherClassRepository.findClassesByTeacherId(teacherUserId),
      teacherClassService.getTeacherSubjects(teacherUserId),
    ]);

    const names = new Set<string>();
    for (const cls of classes) {
      if (cls.subject?.trim()) names.add(cls.subject.trim().toLowerCase());
    }
    for (const name of subjectNames.subjects) {
      if (name.trim()) names.add(name.trim().toLowerCase());
    }
    if (names.size === 0) return [];

    const allSubjects = await this.subjects.find({ select: { id: true, name: true } });
    const subjectIds = allSubjects
      .filter((subject) => names.has(subject.name.trim().toLowerCase()))
      .map((subject) => subject.id);

    if (subjectIds.length === 0) return [];

    const rows = await this.syllabi
      .createQueryBuilder("syllabus")
      .select("syllabus.id", "id")
      .where("syllabus.subjectId IN (:...subjectIds)", { subjectIds })
      .getRawMany<{ id: string }>();

    return rows.map((row) => row.id);
  }

  private async retrieveChunks(
    question: string,
    syllabusIds: string[],
    userId?: string,
  ): Promise<RetrievedChunk[]> {
    if (syllabusIds.length === 0) return [];

    const embedding = await embedText(question, {
      feature: "teacher_coach_retrieval",
      userId,
      metadata: { syllabusCount: syllabusIds.length },
    });

    if (await hasPgVector()) {
      try {
        const vector = embeddingToPgVector(embedding);
        const rows = (await AppDataSource.query(
          `
          SELECT
            id,
            "syllabusId",
            "sourceType",
            "sourceLabel",
            content
          FROM syllabus_chunks
          WHERE "syllabusId" = ANY($1::uuid[])
            AND embedding IS NOT NULL
          ORDER BY embedding <=> $2::vector
          LIMIT $3
          `,
          [syllabusIds, vector, RETRIEVAL_LIMIT],
        )) as RetrievedChunk[];
        return rows;
      } catch {
        /* fall through to jsonb ranking */
      }
    }

    const rows = (await AppDataSource.query(
      `
      SELECT
        id,
        "syllabusId",
        "sourceType",
        "sourceLabel",
        content,
        "embeddingJson"
      FROM syllabus_chunks
      WHERE "syllabusId" = ANY($1::uuid[])
        AND "embeddingJson" IS NOT NULL
      LIMIT 800
      `,
      [syllabusIds],
    )) as Array<RetrievedChunk & { embeddingJson: number[] | string }>;

    return rows
      .map((row) => {
        const values = Array.isArray(row.embeddingJson)
          ? row.embeddingJson
          : (JSON.parse(String(row.embeddingJson)) as number[]);
        return {
          id: row.id,
          syllabusId: row.syllabusId,
          sourceType: row.sourceType,
          sourceLabel: row.sourceLabel,
          content: row.content,
          score: cosineSimilarity(embedding, values),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, RETRIEVAL_LIMIT)
      .map((row) => ({
        id: row.id,
        syllabusId: row.syllabusId,
        sourceType: row.sourceType,
        sourceLabel: row.sourceLabel,
        content: row.content,
      }));
  }

  private async buildSyllabusContext(
    teacherUserId: string,
    question: string,
  ): Promise<{ block: string; sources: TeacherCoachSource[] }> {
    try {
      const syllabusIds = await this.teacherSyllabusIds(teacherUserId);
      if (syllabusIds.length === 0) {
        return {
          block:
            "Syllabus knowledge: no matching syllabi for your subjects yet.",
          sources: [],
        };
      }

      const chunks = await this.retrieveChunks(
        question,
        syllabusIds,
        teacherUserId,
      );
      if (chunks.length === 0) {
        return {
          block:
            "Syllabus knowledge: no indexed chunks found for your subjects.",
          sources: [],
        };
      }

      const block = [
        "Syllabus knowledge (retrieved excerpts — use for content/topic questions):",
        ...chunks.map(
          (hit, index) =>
            `[${index + 1}] (${hit.sourceType}${hit.sourceLabel ? ` · ${hit.sourceLabel}` : ""}) ${hit.content}`,
        ),
      ].join("\n");

      const sources: TeacherCoachSource[] = chunks.slice(0, 8).map((hit) => ({
        kind: "document",
        label: hit.sourceLabel || hit.sourceType,
        detail: hit.syllabusId,
      }));

      return { block, sources };
    } catch (error) {
      logger.warn(
        { err: error, teacherUserId },
        "Teacher syllabus retrieval failed",
      );
      return {
        block:
          "Syllabus knowledge: retrieval failed. Prefer ops tools for schedule/attendance questions.",
        sources: [],
      };
    }
  }

  async getConversation(userId: string, threadId?: string | null) {
    let thread: TeacherCoachThread | null = null;
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

    let thread: TeacherCoachThread;
    if (input.threadId) {
      thread = await this.requireOwnedThread(userId, input.threadId);
    } else {
      thread = this.threads.create({
        ownerUserId: userId,
        title: content.slice(0, 80),
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
    const collectedSources: TeacherCoachSource[] = [];
    const syllabus = await this.buildSyllabusContext(userId, content);
    collectedSources.push(...syllabus.sources);

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `${SYSTEM_PROMPT}\n\nToday's date (UTC): ${today}\n\n${syllabus.block}`,
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
            tools: TEACHER_COACH_TOOL_DEFINITIONS,
            tool_choice: "auto",
          },
          {
            feature: "teacher_coach_chat",
            userId,
            metadata: { threadId: thread.id, round },
          },
        );

        const choice = completion.choices[0]?.message;
        if (!choice) {
          throw new AppError(
            503,
            "Teacher assistant is temporarily unavailable.",
            "TEACHER_COACH_UNAVAILABLE",
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

        for (const call of toolCalls) {
          if (call.type !== "function") continue;
          try {
            const result = await executeTeacherCoachTool(
              userId,
              call.function.name,
              call.function.arguments,
            );
            collectedSources.push(...result.sources);
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
      }

      throw new AppError(
        503,
        "Teacher assistant is temporarily unavailable.",
        "TEACHER_COACH_TOOL_LIMIT",
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        503,
        "Teacher assistant is temporarily unavailable.",
        "TEACHER_COACH_UNAVAILABLE",
      );
    }
  }
}

export const teacherCoachService = new TeacherCoachService();
