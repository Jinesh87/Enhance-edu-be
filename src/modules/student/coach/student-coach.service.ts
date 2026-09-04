import { In } from "typeorm";
import { EnrollmentStatus } from "../../../common/constants/enrollment.js";
import {
  CHAT_MODEL,
  embedText,
  embeddingToPgVector,
  getOpenAIClient,
} from "../../../common/ai/openai-client.js";
import { AppError } from "../../../common/errors/AppError.js";
import { AppDataSource } from "../../../config/data-source.js";
import {
  CoachMessage,
  CoachThread,
  Enrollment,
  Student,
  Syllabus,
} from "../../../entities/index.js";
import {
  cosineSimilarity,
  hasPgVector,
} from "../../coach/embedding-store.js";

const HISTORY_LIMIT = 12;
const RETRIEVAL_LIMIT = 8;

type RetrievedChunk = {
  id: string;
  syllabusId: string;
  sourceType: string;
  sourceLabel: string | null;
  content: string;
};

function toMessageDto(message: CoachMessage) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    sources: message.sources,
    createdAt: message.createdAt.toISOString(),
  };
}

function toThreadDto(thread: CoachThread) {
  return {
    id: thread.id,
    title: thread.title,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
  };
}

export class StudentCoachService {
  private readonly students = AppDataSource.getRepository(Student);
  private readonly enrollments = AppDataSource.getRepository(Enrollment);
  private readonly syllabi = AppDataSource.getRepository(Syllabus);
  private readonly threads = AppDataSource.getRepository(CoachThread);
  private readonly messages = AppDataSource.getRepository(CoachMessage);

  private async requireStudent(userId: string) {
    const student = await this.students.findOne({ where: { userId } });
    if (!student) {
      throw new AppError(404, "Student record not found", "STUDENT_NOT_FOUND");
    }
    return student;
  }

  private async enrolledSyllabusIds(studentId: string): Promise<string[]> {
    const enrollments = await this.enrollments.find({
      where: {
        studentId,
        status: In([
          EnrollmentStatus.ACTIVE,
          EnrollmentStatus.AWAITING_GUARDIAN,
        ]),
      },
      relations: {
        subjects: true,
        term: { academicYear: true, yearLevel: true },
      },
    });

    if (enrollments.length === 0) return [];

    const subjectIds = new Set<string>();
    const termIds = new Set<string>();
    const academicYearIds = new Set<string>();
    const yearLevelIds = new Set<string>();

    for (const enrollment of enrollments) {
      termIds.add(enrollment.termId);
      if (enrollment.term?.academicYear?.id) {
        academicYearIds.add(enrollment.term.academicYear.id);
      }
      if (enrollment.term?.yearLevel?.id) {
        yearLevelIds.add(enrollment.term.yearLevel.id);
      }
      for (const row of enrollment.subjects ?? []) {
        subjectIds.add(row.subjectId);
      }
    }

    if (subjectIds.size === 0) return [];

    const query = this.syllabi
      .createQueryBuilder("syllabus")
      .select("syllabus.id", "id")
      .where("syllabus.subjectId IN (:...subjectIds)", {
        subjectIds: [...subjectIds],
      });

    if (academicYearIds.size > 0) {
      query.andWhere("syllabus.academicYearId IN (:...academicYearIds)", {
        academicYearIds: [...academicYearIds],
      });
    }

    if (yearLevelIds.size > 0) {
      query.andWhere("syllabus.yearLevelId IN (:...yearLevelIds)", {
        yearLevelIds: [...yearLevelIds],
      });
    }

    if (termIds.size > 0) {
      query.andWhere(
        `(syllabus.appliesToAllTerms = true OR syllabus.termId IN (:...termIds))`,
        { termIds: [...termIds] },
      );
    }

    const rows = await query.getRawMany<{ id: string }>();
    return rows.map((row) => row.id);
  }

  private async retrieveChunks(
    question: string,
    syllabusIds: string[],
  ): Promise<RetrievedChunk[]> {
    if (syllabusIds.length === 0) return [];

    const embedding = await embedText(question);

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

  async getConversation(userId: string) {
    const student = await this.requireStudent(userId);
    const thread = await this.threads.findOne({
      where: { studentId: student.id },
      order: { updatedAt: "DESC" },
    });

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
    const student = await this.requireStudent(userId);
    const threads = await this.threads.find({
      where: { studentId: student.id },
      order: { updatedAt: "DESC" },
      take: 50,
    });
    return { threads: threads.map(toThreadDto) };
  }

  async createThread(userId: string) {
    const student = await this.requireStudent(userId);
    const thread = this.threads.create({
      studentId: student.id,
      title: null,
    });
    await this.threads.save(thread);
    return { thread: toThreadDto(thread), messages: [] as ReturnType<typeof toMessageDto>[] };
  }

  async sendMessage(
    userId: string,
    input: { content: string; threadId?: string | null },
  ) {
    const student = await this.requireStudent(userId);
    const content = input.content.trim();
    if (!content) {
      throw new AppError(400, "Message is required", "VALIDATION_ERROR");
    }

    let thread: CoachThread | null = null;
    if (input.threadId) {
      thread = await this.threads.findOne({
        where: { id: input.threadId, studentId: student.id },
      });
      if (!thread) {
        throw new AppError(404, "Chat not found", "COACH_THREAD_NOT_FOUND");
      }
    } else {
      thread = this.threads.create({
        studentId: student.id,
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

    const syllabusIds = await this.enrolledSyllabusIds(student.id);
    let chunks: RetrievedChunk[] = [];
    try {
      chunks = await this.retrieveChunks(content, syllabusIds);
    } catch (error) {
      throw new AppError(
        503,
        "Coach retrieval is unavailable. Ensure pgvector is installed and syllabi are indexed.",
        "COACH_RETRIEVAL_UNAVAILABLE",
        error,
      );
    }

    const history = await this.messages.find({
      where: { threadId: thread.id },
      order: { createdAt: "DESC" },
      take: HISTORY_LIMIT,
    });
    history.reverse();

    const contextBlock =
      chunks.length > 0
        ? chunks
            .map(
              (chunk, index) =>
                `[${index + 1}] (${chunk.sourceType}${
                  chunk.sourceLabel ? `: ${chunk.sourceLabel}` : ""
                })\n${chunk.content}`,
            )
            .join("\n\n")
        : "No matching syllabus excerpts were found for this student's enrolled subjects.";

    const systemPrompt = [
      "You are an academic coach for a school student.",
      "Answer using ONLY the provided syllabus context when possible.",
      "If the context does not contain enough information, say so clearly and suggest what part of the syllabus to review.",
      "Be concise, encouraging, and age-appropriate. Do not invent curriculum details.",
      "",
      "Syllabus context:",
      contextBlock,
    ].join("\n");

    const prior = history.filter((msg) => msg.id !== userMessage.id);
    const openai = await getOpenAIClient();
    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      temperature: 0.3,
      messages: [
        { role: "system", content: systemPrompt },
        ...prior.map((msg) => ({
          role:
            msg.role === "assistant"
              ? ("assistant" as const)
              : ("user" as const),
          content: msg.content,
        })),
        { role: "user" as const, content },
      ],
    });

    const replyText =
      completion.choices[0]?.message?.content?.trim() ||
      "I could not generate a reply right now. Please try again.";

    const sources = chunks.map((chunk) => ({
      syllabusId: chunk.syllabusId,
      sourceType: chunk.sourceType,
      sourceLabel: chunk.sourceLabel,
      excerpt: chunk.content.slice(0, 240),
    }));

    const assistantMessage = this.messages.create({
      threadId: thread.id,
      role: "assistant",
      content: replyText,
      sources,
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
}

export const studentCoachService = new StudentCoachService();
