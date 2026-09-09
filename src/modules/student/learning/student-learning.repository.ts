import { In } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import { EnrollmentStatus } from "../../../common/constants/enrollment.js";
import type { FlashcardProgressStatus } from "../../../common/constants/learning.js";
import type { LearningGenerationType } from "../../../common/constants/learning.js";
import {
  Enrollment,
  LearningFlashcard,
  LearningFlashcardProgress,
  LearningQuizAnswer,
  LearningQuizAttempt,
  LearningQuizQuestion,
  LearningRevisionQuestion,
  LearningSet,
  Student,
} from "../../../entities/index.js";

export type EnrollmentScope = { termId: string; subjectId: string };

export type BestAttemptRow = {
  learningSetId: string;
  attemptId: string;
  score: string;
  totalMarks: string;
  percentage: string | null;
  completedAt: Date;
};

export type PendingAttemptRow = {
  learningSetId: string;
  attemptId: string;
  startedAt: Date;
};

export class StudentLearningRepository {
  private readonly sets = AppDataSource.getRepository(LearningSet);
  private readonly students = AppDataSource.getRepository(Student);
  private readonly enrollments = AppDataSource.getRepository(Enrollment);
  private readonly flashcards = AppDataSource.getRepository(LearningFlashcard);
  private readonly progress = AppDataSource.getRepository(
    LearningFlashcardProgress,
  );
  private readonly questions = AppDataSource.getRepository(LearningQuizQuestion);
  private readonly revisions = AppDataSource.getRepository(
    LearningRevisionQuestion,
  );
  private readonly attempts = AppDataSource.getRepository(LearningQuizAttempt);
  private readonly answers = AppDataSource.getRepository(LearningQuizAnswer);

  async findStudentByUserId(userId: string) {
    return this.students.findOne({ where: { userId } });
  }

  async findActiveEnrollmentsForStudent(studentProfileId: string) {
    return this.enrollments.find({
      where: {
        studentId: studentProfileId,
        status: In([EnrollmentStatus.ACTIVE]),
      },
      relations: {
        subjects: true,
        term: { yearLevel: true },
      },
    });
  }

  async findSetById(setId: string) {
    return this.sets.findOne({
      where: { id: setId },
      relations: {
        subject: true,
        term: { academicYear: true, yearLevel: true },
      },
    });
  }

  async findSetByIdOrFail(setId: string) {
    return this.sets.findOneByOrFail({ id: setId });
  }

  async findPublishedSetsInScope(termIds: string[], subjectIds: string[]) {
    if (termIds.length === 0 || subjectIds.length === 0) return [];
    return this.sets
      .createQueryBuilder("set")
      .leftJoinAndSelect("set.subject", "subject")
      .leftJoinAndSelect("set.term", "term")
      .where("set.status = :status", { status: "PUBLISHED" })
      .andWhere("set.termId IN (:...termIds)", { termIds })
      .andWhere("set.subjectId IN (:...subjectIds)", { subjectIds })
      .orderBy("subject.name", "ASC")
      .addOrderBy("set.title", "ASC")
      .getMany();
  }

  async findAttemptedSetIds(studentId: string) {
    const rows = await this.attempts.find({
      where: { studentId },
      select: { learningSetId: true },
    });
    return [...new Set(rows.map((row) => row.learningSetId))];
  }

  async findSetsByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return this.sets.find({
      where: { id: In(ids) },
      relations: {
        subject: true,
        term: { academicYear: true, yearLevel: true },
      },
    });
  }

  async countAttemptsForSet(studentId: string, setId: string) {
    return this.attempts.count({
      where: { studentId, learningSetId: setId },
    });
  }

  /** Batch item counts for many sets, keyed by learningSetId. */
  async countItemsBySetIds(
    sets: Array<{ id: string; generationType: LearningGenerationType }>,
  ) {
    const counts = new Map<string, number>();
    if (sets.length === 0) return counts;

    const byType = {
      flashcards: sets.filter((s) => s.generationType === "flashcards").map((s) => s.id),
      quiz: sets.filter((s) => s.generationType === "quiz").map((s) => s.id),
      revision: sets.filter((s) => s.generationType === "revision").map((s) => s.id),
    };

    const loadCounts = async (
      repo:
        | typeof this.flashcards
        | typeof this.questions
        | typeof this.revisions,
      ids: string[],
    ) => {
      if (ids.length === 0) return;
      const rows = await repo
        .createQueryBuilder("row")
        .select("row.learningSetId", "learningSetId")
        .addSelect("COUNT(*)", "count")
        .where("row.learningSetId IN (:...ids)", { ids })
        .groupBy("row.learningSetId")
        .getRawMany<{ learningSetId: string; count: string }>();
      for (const row of rows) {
        counts.set(row.learningSetId, Number(row.count) || 0);
      }
    };

    await Promise.all([
      loadCounts(this.flashcards, byType.flashcards),
      loadCounts(this.questions, byType.quiz),
      loadCounts(this.revisions, byType.revision),
    ]);

    for (const set of sets) {
      if (!counts.has(set.id)) counts.set(set.id, 0);
    }
    return counts;
  }

  /**
   * Best completed attempt per set for a student (score DESC, completedAt ASC).
   * One query for all setIds.
   */
  async findBestAttemptsBySetIds(studentId: string, setIds: string[]) {
    const best = new Map<string, BestAttemptRow>();
    if (setIds.length === 0) return best;

    const rows = await this.attempts
      .createQueryBuilder("a")
      .where("a.studentId = :studentId", { studentId })
      .andWhere("a.learningSetId IN (:...setIds)", { setIds })
      .andWhere("a.completedAt IS NOT NULL")
      .orderBy("a.score", "DESC")
      .addOrderBy("a.completedAt", "ASC")
      .getMany();

    for (const row of rows) {
      if (best.has(row.learningSetId)) continue;
      best.set(row.learningSetId, {
        learningSetId: row.learningSetId,
        attemptId: row.id,
        score: row.score,
        totalMarks: row.totalMarks,
        percentage: row.percentage,
        completedAt: row.completedAt!,
      });
    }
    return best;
  }

  async findBestAttempt(studentId: string, setId: string) {
    const map = await this.findBestAttemptsBySetIds(studentId, [setId]);
    return map.get(setId) ?? null;
  }

  /** Latest incomplete attempt per set. */
  async findPendingAttemptsBySetIds(studentId: string, setIds: string[]) {
    const pending = new Map<string, PendingAttemptRow>();
    if (setIds.length === 0) return pending;

    const rows = await this.attempts
      .createQueryBuilder("a")
      .where("a.studentId = :studentId", { studentId })
      .andWhere("a.learningSetId IN (:...setIds)", { setIds })
      .andWhere("a.completedAt IS NULL")
      .orderBy("a.startedAt", "DESC")
      .getMany();

    for (const row of rows) {
      if (pending.has(row.learningSetId)) continue;
      pending.set(row.learningSetId, {
        learningSetId: row.learningSetId,
        attemptId: row.id,
        startedAt: row.startedAt,
      });
    }
    return pending;
  }

  async findPendingAttempt(studentId: string, setId: string) {
    const map = await this.findPendingAttemptsBySetIds(studentId, [setId]);
    return map.get(setId) ?? null;
  }

  async findFlashcardsForSet(setId: string) {
    return this.flashcards.find({
      where: { learningSetId: setId },
      order: { position: "ASC" },
    });
  }

  async findFlashcardById(flashcardId: string) {
    return this.flashcards.findOne({ where: { id: flashcardId } });
  }

  async findProgressForFlashcards(studentId: string, flashcardIds: string[]) {
    if (flashcardIds.length === 0) return [];
    return this.progress
      .createQueryBuilder("p")
      .where("p.studentId = :studentId", { studentId })
      .andWhere("p.flashcardId IN (:...ids)", { ids: flashcardIds })
      .getMany();
  }

  async findProgress(studentId: string, flashcardId: string) {
    return this.progress.findOne({ where: { studentId, flashcardId } });
  }

  async saveProgress(row: LearningFlashcardProgress) {
    return this.progress.save(row);
  }

  createProgress(data: {
    studentId: string;
    flashcardId: string;
    status: FlashcardProgressStatus;
  }) {
    return this.progress.create(data);
  }

  async findQuizQuestionsForSet(setId: string) {
    return this.questions.find({
      where: { learningSetId: setId },
      relations: { options: true },
      order: { position: "ASC" },
    });
  }

  async countQuizQuestions(setId: string) {
    return this.questions.count({ where: { learningSetId: setId } });
  }

  async findRevisionQuestionsForSet(setId: string) {
    return this.revisions.find({
      where: { learningSetId: setId },
      order: { position: "ASC" },
    });
  }

  async findIncompleteAttempt(studentId: string, setId: string) {
    return this.attempts
      .createQueryBuilder("a")
      .where("a.studentId = :studentId", { studentId })
      .andWhere("a.learningSetId = :setId", { setId })
      .andWhere("a.completedAt IS NULL")
      .getOne();
  }

  async createAttempt(data: {
    learningSetId: string;
    studentId: string;
    score: string;
    totalMarks: string;
    correctCount: number;
    totalQuestions: number;
    percentage: string | null;
    startedAt: Date;
    completedAt: Date | null;
  }) {
    return this.attempts.save(this.attempts.create(data));
  }

  async findAttemptForStudent(attemptId: string, studentId: string) {
    return this.attempts.findOne({
      where: { id: attemptId, studentId },
      relations: { learningSet: true },
    });
  }

  async findAttemptByIdForStudent(attemptId: string, studentId: string) {
    return this.attempts.findOne({
      where: { id: attemptId, studentId },
    });
  }

  async findAnswersForAttempt(attemptId: string) {
    return this.answers.find({ where: { attemptId } });
  }

  async saveCompletedAttemptWithAnswers(input: {
    attempt: LearningQuizAttempt;
    answers: Array<{
      questionId: string;
      selectedOptionId: string | null;
      isCorrect: boolean;
    }>;
  }) {
    return AppDataSource.transaction(async (manager) => {
      const answersRepo = manager.getRepository(LearningQuizAnswer);
      const attemptsRepo = manager.getRepository(LearningQuizAttempt);

      await answersRepo.delete({ attemptId: input.attempt.id });

      if (input.answers.length > 0) {
        await answersRepo.insert(
          input.answers.map((row) => ({
            attemptId: input.attempt.id,
            questionId: row.questionId,
            selectedOptionId: row.selectedOptionId,
            isCorrect: row.isCorrect,
          })),
        );
      }

      return attemptsRepo.save(input.attempt);
    });
  }
}

export const studentLearningRepository = new StudentLearningRepository();
