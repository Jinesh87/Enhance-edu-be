import { randomUUID } from "crypto";
import { In } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import { AppError } from "../../../common/errors/AppError.js";
import { EnrollmentStatus } from "../../../common/constants/enrollment.js";
import { UserRole } from "../../../common/constants/roles.js";
import {
  LEARNING_DEFAULT_ITEMS,
  LEARNING_MAX_PDF_BYTES,
  type LearningDifficulty,
  type LearningGenerationType,
} from "../../../common/constants/learning.js";
import {
  deleteObject,
  putObject,
  type IncomingStoredFile,
} from "../../../common/storage/object-storage.js";
import {
  termYearLevelNumber,
  yearLevelsCompatible,
} from "../../../common/utils/year-level.js";
import {
  DEFAULT_CLASS_TIMEZONE,
  resolveIanaTimeZone,
  zonedWallTimeToUtc,
} from "../../../common/utils/timezone.js";
import {
  Enrollment,
  LearningFlashcard,
  LearningFlashcardProgress,
  LearningQuizAnswer,
  LearningQuizAttempt,
  LearningQuizOption,
  LearningQuizQuestion,
  LearningRevisionQuestion,
  LearningSet,
  LearningSourceDocument,
  Subject,
  TeacherSubject,
  Term,
} from "../../../entities/index.js";
import { extractLearningPdfText } from "../../learning/pdf-extract.js";
import {
  generateLearningContent,
  type GeneratedFlashcards,
  type GeneratedQuiz,
  type GeneratedRevision,
} from "../../learning/generator.service.js";
import {
  acquireLearningGenerateLock,
  assertLearningGenerateRateLimit,
} from "../../learning/rate-limit.js";

function isStaff(role: UserRole) {
  return role === UserRole.STAFF;
}

/** Combine YYYY-MM-DD + HH:mm in class timezone into a UTC Date. */
function parseDueAt(
  dueDate?: string | null,
  dueTime?: string | null,
  timeZone: string = DEFAULT_CLASS_TIMEZONE,
): Date | null {
  const date = dueDate?.trim();
  const time = dueTime?.trim();
  if (!date || !time) return null;
  const dateParts = date.split("-").map(Number);
  const timeParts = time.split(":").map(Number);
  if (dateParts.length !== 3 || timeParts.length < 2) {
    throw new AppError(400, "Invalid due date or time", "INVALID_DUE_AT");
  }
  const [year, month, day] = dateParts;
  const [hour, minute] = timeParts;
  if (
    ![year, month, day, hour, minute].every((n) => Number.isFinite(n))
  ) {
    throw new AppError(400, "Invalid due date or time", "INVALID_DUE_AT");
  }
  const parsed = zonedWallTimeToUtc(
    { year, month, day, hour, minute, second: 0 },
    resolveIanaTimeZone(timeZone),
  );
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(400, "Invalid due date or time", "INVALID_DUE_AT");
  }
  return parsed;
}

function dueAtPartsInClassTz(dueAt: Date) {
  const tz = resolveIanaTimeZone(DEFAULT_CLASS_TIMEZONE);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(dueAt);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "0";
  let hour = Number(value("hour"));
  if (hour === 24) hour = 0;
  return {
    dueDate: `${value("year")}-${value("month")}-${value("day")}`,
    dueTime: `${String(hour).padStart(2, "0")}:${value("minute")}`,
  };
}

function isAdmin(role: UserRole) {
  return role === UserRole.SUPER_ADMIN || role === UserRole.OFFICE_STAFF;
}

function toSourceDto(doc: LearningSourceDocument | null | undefined) {
  if (!doc) return null;
  return {
    id: doc.id,
    originalName: doc.originalName,
    mimeType: doc.mimeType,
    byteSize: doc.byteSize,
    extractionMethod: doc.extractionMethod,
    createdAt: doc.createdAt.toISOString(),
  };
}

function marksNumber(value: string | number | null | undefined): number {
  const n = Number(value ?? 1);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function sameText(left: string | null | undefined, right: string) {
  return (left ?? "").trim().toLowerCase() === right.trim().toLowerCase();
}

function toTermDto(term: Term) {
  return {
    id: term.id,
    name: term.name,
    startDate: term.startDate,
    endDate: term.endDate,
    academicYear: term.academicYear
      ? {
          id: term.academicYear.id,
          year: term.academicYear.year,
          displayName: term.academicYear.displayName,
        }
      : null,
    yearLevel: term.yearLevel
      ? {
          id: term.yearLevel.id,
          name: term.yearLevel.name,
          sequence: term.yearLevel.sequence,
        }
      : null,
  };
}

export class TeacherLearningService {
  private readonly sets = AppDataSource.getRepository(LearningSet);
  private readonly sources = AppDataSource.getRepository(LearningSourceDocument);
  private readonly flashcards = AppDataSource.getRepository(LearningFlashcard);
  private readonly questions = AppDataSource.getRepository(LearningQuizQuestion);
  private readonly options = AppDataSource.getRepository(LearningQuizOption);
  private readonly revisions = AppDataSource.getRepository(
    LearningRevisionQuestion,
  );
  private readonly attempts = AppDataSource.getRepository(LearningQuizAttempt);
  private readonly answers = AppDataSource.getRepository(LearningQuizAnswer);
  private readonly flashcardProgress = AppDataSource.getRepository(
    LearningFlashcardProgress,
  );
  private readonly subjects = AppDataSource.getRepository(Subject);
  private readonly teacherSubjects = AppDataSource.getRepository(TeacherSubject);
  private readonly terms = AppDataSource.getRepository(Term);
  private readonly enrollments = AppDataSource.getRepository(Enrollment);

  async lookups(userId: string, role: UserRole) {
    const terms = await this.terms.find({
      where: { isTrial: false },
      relations: { academicYear: true, yearLevel: true },
      order: { startDate: "ASC" },
    });

    let subjects: Subject[];
    if (isStaff(role)) {
      const rows = await this.teacherSubjects.find({
        where: { teacherId: userId },
        relations: { subject: { yearLevel: true } },
        order: { createdAt: "ASC" },
      });
      subjects = rows
        .map((r) => r.subject)
        .filter((s): s is Subject => Boolean(s));
    } else {
      subjects = await this.subjects.find({
        relations: { yearLevel: true },
        order: { name: "ASC" },
      });
    }

    return {
      terms: terms.map(toTermDto),
      subjects: subjects.map((s) => ({
        id: s.id,
        name: s.name,
        yearLevel: s.yearLevel
          ? { id: s.yearLevel.id, name: s.yearLevel.name }
          : null,
      })),
      ocrAvailable: true,
    };
  }

  private async assertSubjectAccess(
    userId: string,
    role: UserRole,
    subjectId: string,
  ) {
    if (isAdmin(role)) return;
    const link = await this.teacherSubjects.findOne({
      where: { teacherId: userId, subjectId },
    });
    if (!link) {
      throw new AppError(
        403,
        "You are not assigned to this subject.",
        "FORBIDDEN",
      );
    }
  }

  private async assertScope(
    userId: string,
    role: UserRole,
    input: { termId: string; yearGroup: string; subjectId: string },
  ) {
    const term = await this.terms.findOne({
      where: { id: input.termId },
      relations: { academicYear: true, yearLevel: true },
    });
    if (!term || term.isTrial) {
      throw new AppError(404, "Term not found", "TERM_NOT_FOUND");
    }
    if (!sameText(term.yearLevel?.name, input.yearGroup)) {
      throw new AppError(
        400,
        "Selected term does not match the year level",
        "TERM_YEAR_LEVEL_MISMATCH",
      );
    }

    const subject = await this.subjects.findOne({
      where: { id: input.subjectId },
      relations: { yearLevel: true },
    });
    if (!subject) {
      throw new AppError(404, "Subject not found", "SUBJECT_NOT_FOUND");
    }
    if (
      subject.yearLevel?.name &&
      !sameText(subject.yearLevel.name, input.yearGroup)
    ) {
      throw new AppError(
        400,
        "Selected subject does not match the year level",
        "SUBJECT_YEAR_LEVEL_MISMATCH",
      );
    }

    await this.assertSubjectAccess(userId, role, subject.id);

    const studentIds = await this.resolveStudentIds(term, subject.id);
    if (studentIds.length === 0) {
      throw new AppError(
        400,
        "No enrolled students found for this subject and year level",
        "NO_LEARNING_STUDENTS",
      );
    }

    return { term, subject, studentIds };
  }

  private async resolveStudentIds(term: Term, subjectId: string) {
    const termYear = termYearLevelNumber(term);
    const enrollments = await this.enrollments.find({
      where: {
        termId: term.id,
        status: In([EnrollmentStatus.ACTIVE]),
      },
      relations: {
        student: true,
        subjects: { subject: true },
      },
    });

    const studentIds = new Set<string>();
    for (const enrollment of enrollments) {
      const hasSubject = (enrollment.subjects ?? []).some(
        (row) => row.subjectId === subjectId,
      );
      if (!hasSubject) continue;
      if (
        !yearLevelsCompatible(enrollment.student?.yearLevel ?? null, termYear)
      ) {
        continue;
      }
      if (enrollment.student?.userId) {
        studentIds.add(enrollment.student.userId);
      }
    }
    return [...studentIds];
  }

  private async getOwnedSet(userId: string, role: UserRole, setId: string) {
    const set = await this.sets.findOne({
      where: { id: setId },
      relations: {
        subject: true,
        term: { academicYear: true, yearLevel: true },
        sourceDocument: true,
        teacher: true,
      },
    });
    if (!set) {
      throw new AppError(404, "Learning set not found", "LEARNING_SET_NOT_FOUND");
    }
    if (isStaff(role) && set.teacherId !== userId) {
      throw new AppError(403, "Forbidden", "FORBIDDEN");
    }
    return set;
  }

  async list(
    userId: string,
    role: UserRole,
    filters: {
      subjectId?: string;
      termId?: string;
      status?: string;
      academicYear?: string;
      yearGroup?: string;
      generationType?: string;
    } = {},
  ) {
    const qb = this.sets
      .createQueryBuilder("set")
      .leftJoinAndSelect("set.subject", "subject")
      .leftJoinAndSelect("set.term", "term")
      .leftJoinAndSelect("term.academicYear", "academicYear")
      .leftJoinAndSelect("term.yearLevel", "termYearLevel")
      .leftJoinAndSelect("set.sourceDocument", "source")
      .leftJoinAndSelect("set.teacher", "teacher")
      .orderBy("set.updatedAt", "DESC");

    if (isStaff(role)) {
      qb.andWhere("set.teacherId = :userId", { userId });
    }
    if (filters.subjectId) {
      qb.andWhere("set.subjectId = :subjectId", {
        subjectId: filters.subjectId,
      });
    }
    if (filters.termId) {
      qb.andWhere("set.termId = :termId", { termId: filters.termId });
    }
    if (filters.status) {
      qb.andWhere("set.status = :status", { status: filters.status });
    }
    if (filters.generationType) {
      qb.andWhere("set.generationType = :generationType", {
        generationType: filters.generationType,
      });
    }
    if (filters.yearGroup?.trim()) {
      qb.andWhere("LOWER(set.yearGroup) = LOWER(:yearGroup)", {
        yearGroup: filters.yearGroup.trim(),
      });
    }
    if (filters.academicYear?.trim()) {
      const year = Number(filters.academicYear);
      if (Number.isFinite(year)) {
        qb.andWhere("academicYear.year = :academicYear", {
          academicYear: year,
        });
      }
    }

    const rows = await qb.getMany();
    const dtos = await Promise.all(rows.map((row) => this.toSetSummary(row)));
    return { learningSets: dtos };
  }

  async getById(userId: string, role: UserRole, setId: string) {
    const set = await this.getOwnedSet(userId, role, setId);
    return { learningSet: await this.toSetDetail(set) };
  }

  async create(
    userId: string,
    role: UserRole,
    input: {
      title: string;
      subjectId: string;
      termId: string;
      yearGroup: string;
      generationType: LearningGenerationType;
      difficulty?: LearningDifficulty;
      itemCount?: number;
      marksPerQuestion?: number;
      forceOcr?: boolean;
      dueDate?: string | null;
      dueTime?: string | null;
    },
    upload: IncomingStoredFile | null,
  ) {
    if (!upload) {
      throw new AppError(400, "A PDF source document is required", "PDF_REQUIRED");
    }
    this.assertPdfUpload(upload);

    await this.assertScope(userId, role, {
      termId: input.termId,
      yearGroup: input.yearGroup,
      subjectId: input.subjectId,
    });

    const buffer = upload.buffer;
    if (!buffer) {
      throw new AppError(400, "Upload buffer missing", "INVALID_UPLOAD");
    }

    const dueAt =
      input.generationType === "quiz"
        ? parseDueAt(input.dueDate, input.dueTime)
        : null;
    if (input.generationType === "quiz" && !dueAt) {
      throw new AppError(
        400,
        "Due date and time are required for quizzes",
        "DUE_REQUIRED",
      );
    }

    const extracted = await extractLearningPdfText(buffer, {
      forceOcr: Boolean(input.forceOcr),
      originalName: upload.originalName,
    });

    const sourceId = randomUUID();
    const storageKey = `learning-sources/${userId}/${sourceId}-${upload.originalName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    await putObject({
      key: storageKey,
      body: buffer,
      contentType: upload.mimeType || "application/pdf",
    });

    const source = await this.sources.save(
      this.sources.create({
        id: sourceId,
        storageKey,
        originalName: upload.originalName,
        mimeType: upload.mimeType || "application/pdf",
        byteSize: upload.size,
        extractedText: extracted.text,
        extractionMethod: extracted.method,
        uploadedById: userId,
      }),
    );

    const set = await this.sets.save(
      this.sets.create({
        title: input.title.trim(),
        subjectId: input.subjectId,
        termId: input.termId,
        yearGroup: input.yearGroup.trim(),
        teacherId: userId,
        sourceDocumentId: source.id,
        generationType: input.generationType,
        difficulty: input.difficulty ?? "medium",
        itemCount: input.itemCount ?? LEARNING_DEFAULT_ITEMS,
        marksPerQuestion: String(input.marksPerQuestion ?? 1),
        dueAt,
        status: "DRAFT",
      }),
    );

    const full = await this.getOwnedSet(userId, role, set.id);
    return {
      learningSet: await this.toSetDetail(full),
      sourceTruncated: extracted.truncated,
    };
  }

  async update(
    userId: string,
    role: UserRole,
    setId: string,
    input: {
      title?: string;
      difficulty?: LearningDifficulty;
      itemCount?: number;
      marksPerQuestion?: number;
      dueDate?: string | null;
      dueTime?: string | null;
    },
  ) {
    const set = await this.getOwnedSet(userId, role, setId);
    if (set.status === "PUBLISHED") {
      // Allow title/marks tweaks but keep published
    }
    if (input.title !== undefined) set.title = input.title.trim();
    if (input.difficulty !== undefined) set.difficulty = input.difficulty;
    if (input.itemCount !== undefined) set.itemCount = input.itemCount;
    if (input.marksPerQuestion !== undefined) {
      set.marksPerQuestion = String(input.marksPerQuestion);
    }
    if (set.generationType === "quiz") {
      if (input.dueDate !== undefined || input.dueTime !== undefined) {
        const existing = set.dueAt ? dueAtPartsInClassTz(set.dueAt) : null;
        const nextDate =
          input.dueDate !== undefined && input.dueDate !== null && input.dueDate !== ""
            ? String(input.dueDate)
            : (existing?.dueDate ?? "");
        const nextTime =
          input.dueTime !== undefined && input.dueTime !== null && input.dueTime !== ""
            ? String(input.dueTime)
            : (existing?.dueTime ?? "");
        const parsed = parseDueAt(nextDate, nextTime);
        if (!parsed) {
          throw new AppError(
            400,
            "Due date and time are required for quizzes",
            "DUE_REQUIRED",
          );
        }
        set.dueAt = parsed;
      }
    } else {
      set.dueAt = null;
    }
    await this.sets.save(set);
    return { learningSet: await this.toSetDetail(set) };
  }

  async remove(userId: string, role: UserRole, setId: string) {
    const set = await this.getOwnedSet(userId, role, setId);
    const source = set.sourceDocument;
    await this.sets.remove(set);
    if (source) {
      try {
        await deleteObject(source.storageKey);
      } catch {
        /* ignore storage cleanup failures */
      }
      await this.sources.remove(source);
    }
    return { ok: true };
  }

  async generate(
    userId: string,
    role: UserRole,
    setId: string,
    opts: { forceOcr?: boolean } = {},
  ) {
    await assertLearningGenerateRateLimit(userId);
    const release = await acquireLearningGenerateLock(setId);

    try {
      const set = await this.getOwnedSet(userId, role, setId);
      await this.assertCanRegenerate(set);

      if (!set.sourceDocumentId) {
        throw new AppError(400, "Source document missing", "PDF_REQUIRED");
      }

      let source = set.sourceDocument;
      if (!source) {
        source = await this.sources.findOneByOrFail({
          id: set.sourceDocumentId,
        });
      }

      if (opts.forceOcr || !source.extractedText) {
        const { getObjectBuffer } = await import(
          "../../../common/storage/object-storage.js"
        );
        const buffer = await getObjectBuffer(source.storageKey);
        const extracted = await extractLearningPdfText(buffer, {
          forceOcr: Boolean(opts.forceOcr),
          originalName: source.originalName,
        });
        source.extractedText = extracted.text;
        source.extractionMethod = extracted.method;
        await this.sources.save(source);
      }

      const sourceText = source.extractedText?.trim() ?? "";
      if (!sourceText) {
        throw new AppError(
          400,
          "Unable to extract text from the PDF source.",
          "PDF_EMPTY",
        );
      }

      const generated = await generateLearningContent({
        type: set.generationType,
        difficulty: set.difficulty,
        itemCount: set.itemCount,
        subjectName: set.subject?.name ?? "Subject",
        className: `${set.yearGroup} · ${set.term?.name ?? "Term"}`,
        sourceText,
        userId,
        learningSetId: set.id,
        preferredTitle: set.title?.trim() || undefined,
      });

      // Keep the teacher's title. Only fall back to AI title if none was saved.
      const teacherTitle = set.title?.trim();
      if (!teacherTitle && generated.title?.trim()) {
        set.title = generated.title.trim().slice(0, 160);
      }
      set.status = "DRAFT";
      set.publishedAt = null;
      await this.sets.save(set);

      await this.replaceGeneratedItems(set, generated);

      const refreshed = await this.getOwnedSet(userId, role, set.id);
      return { learningSet: await this.toSetDetail(refreshed) };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        502,
        "Unable to generate learning content. Please try again.",
        "AI_GENERATION_FAILED",
      );
    } finally {
      await release();
    }
  }

  /**
   * Production guard: regenerating replaces all items and would break
   * existing student attempts/progress. Require draft + no student activity.
   */
  private async assertCanRegenerate(set: LearningSet) {
    if (set.status === "PUBLISHED") {
      throw new AppError(
        400,
        "Unpublish this set before regenerating so students are not disrupted mid-study.",
        "MUST_UNPUBLISH_FIRST",
      );
    }

    if (set.generationType === "quiz") {
      const attemptCount = await this.attempts.count({
        where: { learningSetId: set.id },
      });
      if (attemptCount > 0) {
        throw new AppError(
          409,
          `Cannot regenerate: ${attemptCount} quiz attempt(s) already exist. Create a new learning set for updated content so completed student work stays valid.`,
          "STUDENT_ACTIVITY_EXISTS",
        );
      }
      return;
    }

    if (set.generationType === "flashcards") {
      const progressCount = await this.flashcardProgress
        .createQueryBuilder("p")
        .innerJoin("p.flashcard", "card")
        .where("card.learningSetId = :setId", { setId: set.id })
        .getCount();
      if (progressCount > 0) {
        throw new AppError(
          409,
          `Cannot regenerate: students already have flashcard progress on this set. Create a new learning set instead.`,
          "STUDENT_ACTIVITY_EXISTS",
        );
      }
    }
  }

  private async replaceGeneratedItems(
    set: LearningSet,
    generated: GeneratedFlashcards | GeneratedQuiz | GeneratedRevision,
  ) {
    if (set.generationType === "flashcards") {
      await this.flashcards.delete({ learningSetId: set.id });
      const items = (generated as GeneratedFlashcards).items;
      await this.flashcards.save(
        items.map((item, index) =>
          this.flashcards.create({
            learningSetId: set.id,
            front: item.front,
            back: item.back,
            position: index,
          }),
        ),
      );
      return;
    }

    if (set.generationType === "quiz") {
      const existing = await this.questions.find({
        where: { learningSetId: set.id },
      });
      if (existing.length) {
        await this.options.delete({
          questionId: In(existing.map((q) => q.id)),
        });
        await this.questions.delete({ learningSetId: set.id });
      }
      const items = (generated as GeneratedQuiz).items;
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        const question = await this.questions.save(
          this.questions.create({
            learningSetId: set.id,
            question: item.question,
            explanation: item.explanation?.trim() || null,
            position: i,
          }),
        );
        await this.options.save(
          item.options.map((text, oi) =>
            this.options.create({
              questionId: question.id,
              text,
              isCorrect: oi === item.correctAnswer,
              position: oi,
            }),
          ),
        );
      }
      return;
    }

    await this.revisions.delete({ learningSetId: set.id });
    const items = (generated as GeneratedRevision).items;
    await this.revisions.save(
      items.map((item, index) =>
        this.revisions.create({
          learningSetId: set.id,
          question: item.question,
          answer: item.answer,
          position: index,
        }),
      ),
    );
  }

  async publish(userId: string, role: UserRole, setId: string) {
    const set = await this.getOwnedSet(userId, role, setId);
    const detail = await this.toSetDetail(set);
    const count =
      set.generationType === "flashcards"
        ? detail.flashcards.length
        : set.generationType === "quiz"
          ? detail.quizQuestions.length
          : detail.revisionQuestions.length;

    if (count < 1) {
      throw new AppError(
        400,
        "Generate or add content before publishing.",
        "EMPTY_LEARNING_SET",
      );
    }

    set.status = "PUBLISHED";
    set.publishedAt = new Date();
    await this.sets.save(set);
    return { learningSet: await this.toSetDetail(set) };
  }

  async unpublish(userId: string, role: UserRole, setId: string) {
    const set = await this.getOwnedSet(userId, role, setId);
    set.status = "DRAFT";
    set.publishedAt = null;
    await this.sets.save(set);
    return { learningSet: await this.toSetDetail(set) };
  }

  async addFlashcard(
    userId: string,
    role: UserRole,
    setId: string,
    input: { front: string; back: string; position?: number },
  ) {
    const set = await this.getOwnedSet(userId, role, setId);
    this.assertType(set, "flashcards");
    const maxPos = await this.flashcards
      .createQueryBuilder("f")
      .select("MAX(f.position)", "max")
      .where("f.learningSetId = :setId", { setId })
      .getRawOne<{ max: number | null }>();
    const card = await this.flashcards.save(
      this.flashcards.create({
        learningSetId: setId,
        front: input.front.trim(),
        back: input.back.trim(),
        position: input.position ?? (maxPos?.max ?? -1) + 1,
      }),
    );
    return { flashcard: this.toFlashcardDto(card) };
  }

  async updateFlashcard(
    userId: string,
    role: UserRole,
    flashcardId: string,
    input: { front?: string; back?: string; position?: number },
  ) {
    const card = await this.flashcards.findOne({
      where: { id: flashcardId },
      relations: { learningSet: true },
    });
    if (!card) throw new AppError(404, "Flashcard not found", "NOT_FOUND");
    await this.getOwnedSet(userId, role, card.learningSetId);
    if (input.front !== undefined) card.front = input.front.trim();
    if (input.back !== undefined) card.back = input.back.trim();
    if (input.position !== undefined) card.position = input.position;
    await this.flashcards.save(card);
    return { flashcard: this.toFlashcardDto(card) };
  }

  async deleteFlashcard(userId: string, role: UserRole, flashcardId: string) {
    const card = await this.flashcards.findOne({ where: { id: flashcardId } });
    if (!card) throw new AppError(404, "Flashcard not found", "NOT_FOUND");
    await this.getOwnedSet(userId, role, card.learningSetId);
    await this.flashcards.remove(card);
    return { ok: true };
  }

  async addQuizQuestion(
    userId: string,
    role: UserRole,
    setId: string,
    input: {
      question: string;
      explanation?: string | null;
      options: Array<{ text: string; isCorrect: boolean }>;
      position?: number;
    },
  ) {
    const set = await this.getOwnedSet(userId, role, setId);
    this.assertType(set, "quiz");
    const maxPos = await this.questions
      .createQueryBuilder("q")
      .select("MAX(q.position)", "max")
      .where("q.learningSetId = :setId", { setId })
      .getRawOne<{ max: number | null }>();

    const question = await this.questions.save(
      this.questions.create({
        learningSetId: setId,
        question: input.question.trim(),
        explanation: input.explanation?.trim() || null,
        position: input.position ?? (maxPos?.max ?? -1) + 1,
      }),
    );
    await this.options.save(
      input.options.map((opt, i) =>
        this.options.create({
          questionId: question.id,
          text: opt.text.trim(),
          isCorrect: opt.isCorrect,
          position: i,
        }),
      ),
    );
    const full = await this.questions.findOneOrFail({
      where: { id: question.id },
      relations: { options: true },
    });
    return { question: this.toQuizQuestionDto(full, true) };
  }

  async updateQuizQuestion(
    userId: string,
    role: UserRole,
    questionId: string,
    input: {
      question?: string;
      explanation?: string | null;
      options?: Array<{ text: string; isCorrect: boolean }>;
      position?: number;
    },
  ) {
    const question = await this.questions.findOne({
      where: { id: questionId },
      relations: { options: true },
    });
    if (!question) throw new AppError(404, "Question not found", "NOT_FOUND");
    await this.getOwnedSet(userId, role, question.learningSetId);

    if (input.question !== undefined) question.question = input.question.trim();
    if (input.explanation !== undefined) {
      question.explanation = input.explanation?.trim() || null;
    }
    if (input.position !== undefined) question.position = input.position;
    await this.questions.save(question);

    if (input.options) {
      await this.options.delete({ questionId: question.id });
      await this.options.save(
        input.options.map((opt, i) =>
          this.options.create({
            questionId: question.id,
            text: opt.text.trim(),
            isCorrect: opt.isCorrect,
            position: i,
          }),
        ),
      );
    }

    const full = await this.questions.findOneOrFail({
      where: { id: question.id },
      relations: { options: true },
    });
    return { question: this.toQuizQuestionDto(full, true) };
  }

  async deleteQuizQuestion(userId: string, role: UserRole, questionId: string) {
    const question = await this.questions.findOne({ where: { id: questionId } });
    if (!question) throw new AppError(404, "Question not found", "NOT_FOUND");
    await this.getOwnedSet(userId, role, question.learningSetId);
    const answerCount = await this.answers.count({
      where: { questionId },
    });
    if (answerCount > 0) {
      throw new AppError(
        409,
        "Cannot delete this question because students already answered it. Edit the text instead, or create a new learning set.",
        "STUDENT_ACTIVITY_EXISTS",
      );
    }
    await this.options.delete({ questionId });
    await this.questions.remove(question);
    return { ok: true };
  }

  async addRevision(
    userId: string,
    role: UserRole,
    setId: string,
    input: { question: string; answer: string; position?: number },
  ) {
    const set = await this.getOwnedSet(userId, role, setId);
    this.assertType(set, "revision");
    const maxPos = await this.revisions
      .createQueryBuilder("r")
      .select("MAX(r.position)", "max")
      .where("r.learningSetId = :setId", { setId })
      .getRawOne<{ max: number | null }>();
    const row = await this.revisions.save(
      this.revisions.create({
        learningSetId: setId,
        question: input.question.trim(),
        answer: input.answer.trim(),
        position: input.position ?? (maxPos?.max ?? -1) + 1,
      }),
    );
    return { revisionQuestion: this.toRevisionDto(row) };
  }

  async updateRevision(
    userId: string,
    role: UserRole,
    revisionId: string,
    input: { question?: string; answer?: string; position?: number },
  ) {
    const row = await this.revisions.findOne({ where: { id: revisionId } });
    if (!row) throw new AppError(404, "Revision question not found", "NOT_FOUND");
    await this.getOwnedSet(userId, role, row.learningSetId);
    if (input.question !== undefined) row.question = input.question.trim();
    if (input.answer !== undefined) row.answer = input.answer.trim();
    if (input.position !== undefined) row.position = input.position;
    await this.revisions.save(row);
    return { revisionQuestion: this.toRevisionDto(row) };
  }

  async deleteRevision(userId: string, role: UserRole, revisionId: string) {
    const row = await this.revisions.findOne({ where: { id: revisionId } });
    if (!row) throw new AppError(404, "Revision question not found", "NOT_FOUND");
    await this.getOwnedSet(userId, role, row.learningSetId);
    await this.revisions.remove(row);
    return { ok: true };
  }

  async leaderboard(userId: string, role: UserRole, setId: string) {
    const set = await this.getOwnedSet(userId, role, setId);
    this.assertType(set, "quiz");
    return this.buildLeaderboard(setId);
  }

  async listAttempts(userId: string, role: UserRole, setId: string) {
    const set = await this.getOwnedSet(userId, role, setId);
    this.assertType(set, "quiz");

    const attempts = await this.attempts.find({
      where: { learningSetId: setId },
      relations: { student: true },
      order: { completedAt: "DESC", startedAt: "DESC" },
    });

    return {
      attempts: attempts.map((a) => ({
        id: a.id,
        studentId: a.studentId,
        studentName:
          a.student?.preferredName?.trim() ||
          a.student?.fullName ||
          "Student",
        score: Number(a.score),
        totalMarks: Number(a.totalMarks),
        correctCount: a.correctCount,
        totalQuestions: a.totalQuestions,
        percentage: a.percentage != null ? Number(a.percentage) : null,
        startedAt: a.startedAt.toISOString(),
        completedAt: a.completedAt?.toISOString() ?? null,
      })),
    };
  }

  async getAttemptReview(userId: string, role: UserRole, attemptId: string) {
    const attempt = await this.attempts.findOne({
      where: { id: attemptId },
      relations: { student: true },
    });
    if (!attempt || !attempt.completedAt) {
      throw new AppError(404, "Completed attempt not found", "NOT_FOUND");
    }

    const set = await this.getOwnedSet(userId, role, attempt.learningSetId);
    this.assertType(set, "quiz");

    const board = await this.buildLeaderboard(attempt.learningSetId);
    const entry = board.leaderboard.find(
      (row) => row.studentId === attempt.studentId,
    );

    let review = attempt.reviewSnapshot;
    if (!review || review.length === 0) {
      const answers = await this.answers.find({ where: { attemptId } });
      const questions = await this.questions.find({
        where: { learningSetId: attempt.learningSetId },
        relations: { options: true },
        order: { position: "ASC" },
      });
      const answerMap = new Map(answers.map((a) => [a.questionId, a]));
      review = questions.map((q) => {
        const ans = answerMap.get(q.id);
        const options = [...(q.options ?? [])].sort(
          (a, b) => a.position - b.position,
        );
        const correct = options.find((o) => o.isCorrect);
        return {
          questionId: q.id,
          question: q.question,
          explanation: q.explanation,
          options: options.map((o) => ({
            id: o.id,
            text: o.text,
            isCorrect: o.isCorrect,
          })),
          selectedOptionId: ans?.selectedOptionId ?? null,
          correctOptionId: correct?.id ?? null,
          isCorrect: ans?.isCorrect ?? false,
        };
      });
    }

    return {
      student: {
        id: attempt.studentId,
        name:
          attempt.student?.preferredName?.trim() ||
          attempt.student?.fullName ||
          "Student",
      },
      result: {
        attemptId: attempt.id,
        score: Number(attempt.score),
        totalMarks: Number(attempt.totalMarks),
        correctCount: attempt.correctCount,
        totalQuestions: attempt.totalQuestions,
        percentage:
          attempt.percentage != null ? Number(attempt.percentage) : null,
        rank: entry?.rank ?? null,
        isWinner: entry?.isWinner ?? false,
        completedAt: attempt.completedAt.toISOString(),
      },
      review,
    };
  }

  async getStudentActivity(userId: string, role: UserRole, setId: string) {
    const set = await this.getOwnedSet(userId, role, setId);
    if (set.generationType === "quiz") {
      const attemptCount = await this.attempts.count({
        where: { learningSetId: setId },
      });
      const completedCount = await this.attempts
        .createQueryBuilder("a")
        .where("a.learningSetId = :setId", { setId })
        .andWhere("a.completedAt IS NOT NULL")
        .getCount();
      const studentCount = await this.attempts
        .createQueryBuilder("a")
        .select("COUNT(DISTINCT a.studentId)", "count")
        .where("a.learningSetId = :setId", { setId })
        .getRawOne<{ count: string }>();
      return {
        generationType: set.generationType,
        hasActivity: attemptCount > 0,
        attemptCount,
        completedCount,
        studentCount: Number(studentCount?.count ?? 0),
      };
    }

    if (set.generationType === "flashcards") {
      const progressCount = await this.flashcardProgress
        .createQueryBuilder("p")
        .innerJoin("p.flashcard", "card")
        .where("card.learningSetId = :setId", { setId })
        .getCount();
      const studentCount = await this.flashcardProgress
        .createQueryBuilder("p")
        .innerJoin("p.flashcard", "card")
        .select("COUNT(DISTINCT p.studentId)", "count")
        .where("card.learningSetId = :setId", { setId })
        .getRawOne<{ count: string }>();
      return {
        generationType: set.generationType,
        hasActivity: progressCount > 0,
        attemptCount: progressCount,
        completedCount: progressCount,
        studentCount: Number(studentCount?.count ?? 0),
      };
    }

    return {
      generationType: set.generationType,
      hasActivity: false,
      attemptCount: 0,
      completedCount: 0,
      studentCount: 0,
    };
  }

  async buildLeaderboard(setId: string) {
    const completed = await this.attempts
      .createQueryBuilder("attempt")
      .leftJoinAndSelect("attempt.student", "student")
      .where("attempt.learningSetId = :setId", { setId })
      .andWhere("attempt.completedAt IS NOT NULL")
      .orderBy("attempt.score", "DESC")
      .addOrderBy("attempt.percentage", "DESC")
      .addOrderBy("attempt.completedAt", "ASC")
      .getMany();

    const bestByStudent = new Map<string, LearningQuizAttempt>();
    for (const attempt of completed) {
      const existing = bestByStudent.get(attempt.studentId);
      if (!existing) {
        bestByStudent.set(attempt.studentId, attempt);
        continue;
      }
      const score = Number(attempt.score);
      const existingScore = Number(existing.score);
      if (
        score > existingScore ||
        (score === existingScore &&
          (attempt.completedAt?.getTime() ?? 0) <
            (existing.completedAt?.getTime() ?? 0))
      ) {
        bestByStudent.set(attempt.studentId, attempt);
      }
    }

    const ranked = Array.from(bestByStudent.values()).sort((a, b) => {
      const scoreDiff = Number(b.score) - Number(a.score);
      if (scoreDiff !== 0) return scoreDiff;
      const pctDiff = Number(b.percentage ?? 0) - Number(a.percentage ?? 0);
      if (pctDiff !== 0) return pctDiff;
      return (
        (a.completedAt?.getTime() ?? 0) - (b.completedAt?.getTime() ?? 0)
      );
    });

    return {
      leaderboard: ranked.map((attempt, index) => ({
        rank: index + 1,
        studentId: attempt.studentId,
        studentName:
          attempt.student?.preferredName?.trim() ||
          attempt.student?.fullName ||
          "Student",
        score: Number(attempt.score),
        totalMarks: Number(attempt.totalMarks),
        percentage: attempt.percentage != null ? Number(attempt.percentage) : 0,
        correctCount: attempt.correctCount,
        totalQuestions: attempt.totalQuestions,
        completedAt: attempt.completedAt?.toISOString() ?? null,
        attemptId: attempt.id,
        isWinner: index === 0,
      })),
      totalParticipants: ranked.length,
    };
  }

  private assertType(set: LearningSet, type: LearningGenerationType) {
    if (set.generationType !== type) {
      throw new AppError(
        400,
        `This learning set is type ${set.generationType}`,
        "INVALID_TYPE",
      );
    }
  }

  private assertPdfUpload(upload: IncomingStoredFile) {
    const mime = (upload.mimeType || "").toLowerCase();
    const name = upload.originalName.toLowerCase();
    if (!mime.includes("pdf") && !name.endsWith(".pdf")) {
      throw new AppError(400, "Only PDF files are supported", "INVALID_UPLOAD");
    }
    if (upload.size > LEARNING_MAX_PDF_BYTES) {
      throw new AppError(
        400,
        "PDF must be 15MB or smaller",
        "FILE_TOO_LARGE",
      );
    }
  }

  private toFlashcardDto(card: LearningFlashcard) {
    return {
      id: card.id,
      front: card.front,
      back: card.back,
      position: card.position,
    };
  }

  private toRevisionDto(row: LearningRevisionQuestion) {
    return {
      id: row.id,
      question: row.question,
      answer: row.answer,
      position: row.position,
    };
  }

  private toQuizQuestionDto(
    question: LearningQuizQuestion,
    includeAnswers: boolean,
  ) {
    const options = [...(question.options ?? [])].sort(
      (a, b) => a.position - b.position,
    );
    return {
      id: question.id,
      question: question.question,
      explanation: includeAnswers ? question.explanation : undefined,
      position: question.position,
      options: options.map((o) => ({
        id: o.id,
        text: o.text,
        position: o.position,
        ...(includeAnswers ? { isCorrect: o.isCorrect } : {}),
      })),
    };
  }

  private async itemCounts(setId: string, type: LearningGenerationType) {
    if (type === "flashcards") {
      return this.flashcards.count({ where: { learningSetId: setId } });
    }
    if (type === "quiz") {
      return this.questions.count({ where: { learningSetId: setId } });
    }
    return this.revisions.count({ where: { learningSetId: setId } });
  }

  private async toSetSummary(set: LearningSet) {
    const count = await this.itemCounts(set.id, set.generationType);
    const mpq = marksNumber(set.marksPerQuestion);
    return {
      id: set.id,
      title: set.title,
      subjectId: set.subjectId,
      subjectName: set.subject?.name ?? null,
      termId: set.termId,
      termName: set.term?.name ?? null,
      yearGroup: set.yearGroup,
      academicYear: set.term?.academicYear?.year ?? null,
      teacherId: set.teacherId,
      teacherName: set.teacher?.fullName ?? null,
      generationType: set.generationType,
      difficulty: set.difficulty,
      itemCount: set.itemCount,
      actualItemCount: count,
      marksPerQuestion: mpq,
      totalMarks: set.generationType === "quiz" ? count * mpq : null,
      status: set.status,
      dueAt: set.dueAt?.toISOString() ?? null,
      publishedAt: set.publishedAt?.toISOString() ?? null,
      sourceDocument: toSourceDto(set.sourceDocument),
      createdAt: set.createdAt.toISOString(),
      updatedAt: set.updatedAt.toISOString(),
    };
  }

  async toSetDetail(set: LearningSet) {
    const summary = await this.toSetSummary(set);
    const flashcards =
      set.generationType === "flashcards"
        ? (
            await this.flashcards.find({
              where: { learningSetId: set.id },
              order: { position: "ASC" },
            })
          ).map((c) => this.toFlashcardDto(c))
        : [];

    const quizQuestions =
      set.generationType === "quiz"
        ? (
            await this.questions.find({
              where: { learningSetId: set.id },
              relations: { options: true },
              order: { position: "ASC" },
            })
          ).map((q) => this.toQuizQuestionDto(q, true))
        : [];

    const revisionQuestions =
      set.generationType === "revision"
        ? (
            await this.revisions.find({
              where: { learningSetId: set.id },
              order: { position: "ASC" },
            })
          ).map((r) => this.toRevisionDto(r))
        : [];

    return {
      ...summary,
      flashcards,
      quizQuestions,
      revisionQuestions,
    };
  }
}

export const teacherLearningService = new TeacherLearningService();
