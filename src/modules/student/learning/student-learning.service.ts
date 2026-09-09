import { AppError } from "../../../common/errors/AppError.js";
import type { FlashcardProgressStatus } from "../../../common/constants/learning.js";
import {
  termYearLevelNumber,
  yearLevelsCompatible,
} from "../../../common/utils/year-level.js";
import { teacherLearningService } from "../../teacher/learning-tools/teacher-learning.service.js";
import {
  studentLearningRepository,
  type EnrollmentScope,
} from "./student-learning.repository.js";

export class StudentLearningService {
  private readonly repo = studentLearningRepository;

  private async enrollmentScopes(userId: string): Promise<EnrollmentScope[]> {
    const student = await this.repo.findStudentByUserId(userId);
    if (!student) return [];

    const enrollments = await this.repo.findActiveEnrollmentsForStudent(
      student.id,
    );

    const scopes: EnrollmentScope[] = [];
    for (const enrollment of enrollments) {
      const termYear = termYearLevelNumber(enrollment.term);
      if (!yearLevelsCompatible(student.yearLevel ?? null, termYear)) {
        continue;
      }
      for (const row of enrollment.subjects ?? []) {
        scopes.push({ termId: enrollment.termId, subjectId: row.subjectId });
      }
    }
    return scopes;
  }

  private async assertLearningAccess(
    studentId: string,
    setId: string,
    mode: "published" | "continue",
  ) {
    const scopes = await this.enrollmentScopes(studentId);
    if (scopes.length === 0) {
      throw new AppError(403, "No active enrolment found", "FORBIDDEN");
    }

    const set = await this.repo.findSetById(setId);
    if (!set) {
      throw new AppError(404, "Learning set not found", "LEARNING_SET_NOT_FOUND");
    }

    const allowed = scopes.some(
      (scope) =>
        scope.termId === set.termId && scope.subjectId === set.subjectId,
    );
    if (!allowed) {
      throw new AppError(403, "Forbidden", "FORBIDDEN");
    }

    if (set.status === "PUBLISHED") {
      return set;
    }

    if (mode === "continue") {
      const attemptCount = await this.repo.countAttemptsForSet(studentId, setId);
      if (attemptCount > 0) {
        return set;
      }
    }

    throw new AppError(404, "Learning set not found", "LEARNING_SET_NOT_FOUND");
  }

  private async assertPublishedAccess(studentId: string, setId: string) {
    return this.assertLearningAccess(studentId, setId, "published");
  }

  private mapBestAttempt(
    row: {
      attemptId: string;
      score: string;
      totalMarks: string;
      percentage: string | null;
      completedAt: Date;
    } | null,
  ) {
    if (!row) return null;
    return {
      attemptId: row.attemptId,
      score: Number(row.score),
      totalMarks: Number(row.totalMarks),
      percentage: row.percentage != null ? Number(row.percentage) : null,
      completedAt: row.completedAt.toISOString(),
    };
  }

  private mapPendingAttempt(
    row: { attemptId: string; startedAt: Date } | null,
  ) {
    if (!row) return null;
    return {
      attemptId: row.attemptId,
      startedAt: row.startedAt.toISOString(),
    };
  }

  async list(studentId: string) {
    const scopes = await this.enrollmentScopes(studentId);
    if (scopes.length === 0) {
      return { subjects: [] as Array<unknown> };
    }

    const termIds = [...new Set(scopes.map((s) => s.termId))];
    const subjectIds = [...new Set(scopes.map((s) => s.subjectId))];
    const scopeKey = new Set(
      scopes.map((s) => `${s.termId}:${s.subjectId}`),
    );

    const published = await this.repo.findPublishedSetsInScope(
      termIds,
      subjectIds,
    );

    // Include draft sets the student already started/completed so they can continue or review.
    const attemptedIds = await this.repo.findAttemptedSetIds(studentId);
    const publishedIdSet = new Set(published.map((s) => s.id));
    const extraIds = attemptedIds.filter((id) => !publishedIdSet.has(id));

    const extras = await this.repo.findSetsByIds(extraIds);
    const sets = [
      ...published,
      ...extras.filter((set) => scopeKey.has(`${set.termId}:${set.subjectId}`)),
    ];

    const visibleSets = sets.filter((set) =>
      scopeKey.has(`${set.termId}:${set.subjectId}`),
    );
    const quizSetIds = visibleSets
      .filter((set) => set.generationType === "quiz")
      .map((set) => set.id);

    const [itemCounts, bestAttempts, pendingAttempts] = await Promise.all([
      this.repo.countItemsBySetIds(visibleSets),
      this.repo.findBestAttemptsBySetIds(studentId, quizSetIds),
      this.repo.findPendingAttemptsBySetIds(studentId, quizSetIds),
    ]);

    const bySubject = new Map<
      string,
      {
        subjectId: string;
        subjectName: string;
        learningSets: Array<Record<string, unknown>>;
      }
    >();

    for (const set of visibleSets) {
      const subjectId = set.subjectId;
      const subjectName = set.subject?.name ?? "Subject";
      if (!bySubject.has(subjectId)) {
        bySubject.set(subjectId, {
          subjectId,
          subjectName,
          learningSets: [],
        });
      }

      const actualItemCount = itemCounts.get(set.id) ?? 0;
      const mpq = Number(set.marksPerQuestion) || 1;
      const isQuiz = set.generationType === "quiz";

      bySubject.get(subjectId)!.learningSets.push({
        id: set.id,
        title: set.title,
        termId: set.termId,
        termName: set.term?.name ?? null,
        yearGroup: set.yearGroup,
        generationType: set.generationType,
        difficulty: set.difficulty,
        itemCount: actualItemCount,
        marksPerQuestion: mpq,
        totalMarks: isQuiz ? actualItemCount * mpq : null,
        publishedAt: set.publishedAt?.toISOString() ?? null,
        status: set.status,
        myBestAttempt: isQuiz
          ? this.mapBestAttempt(bestAttempts.get(set.id) ?? null)
          : null,
        myPendingAttempt: isQuiz
          ? this.mapPendingAttempt(pendingAttempts.get(set.id) ?? null)
          : null,
      });
    }

    return { subjects: Array.from(bySubject.values()) };
  }

  async getSet(studentId: string, setId: string) {
    const set = await this.assertLearningAccess(studentId, setId, "continue");

    if (set.generationType === "flashcards") {
      const cards = await this.repo.findFlashcardsForSet(setId);
      const progressRows = await this.repo.findProgressForFlashcards(
        studentId,
        cards.map((c) => c.id),
      );
      const progressMap = new Map(
        progressRows.map((row) => [row.flashcardId, row]),
      );

      return {
        learningSet: {
          id: set.id,
          title: set.title,
          generationType: set.generationType,
          difficulty: set.difficulty,
          subjectName: set.subject?.name ?? null,
          yearGroup: set.yearGroup,
          termName: set.term?.name ?? null,
          flashcards: cards.map((c) => {
            const progress = progressMap.get(c.id);
            return {
              id: c.id,
              front: c.front,
              back: c.back,
              position: c.position,
              progress: progress
                ? {
                    status: progress.status,
                    lastReviewedAt:
                      progress.lastReviewedAt?.toISOString() ?? null,
                  }
                : null,
            };
          }),
        },
      };
    }

    if (set.generationType === "quiz") {
      const [questions, best, pending, leaderboard] = await Promise.all([
        this.repo.findQuizQuestionsForSet(setId),
        this.repo.findBestAttempt(studentId, setId),
        this.repo.findPendingAttempt(studentId, setId),
        teacherLearningService.buildLeaderboard(setId),
      ]);
      const mpq = Number(set.marksPerQuestion) || 1;
      const myRank =
        leaderboard.leaderboard.find((row) => row.studentId === studentId)
          ?.rank ?? null;

      return {
        learningSet: {
          id: set.id,
          title: set.title,
          generationType: set.generationType,
          difficulty: set.difficulty,
          subjectName: set.subject?.name ?? null,
          yearGroup: set.yearGroup,
          termName: set.term?.name ?? null,
          marksPerQuestion: mpq,
          totalMarks: questions.length * mpq,
          totalQuestions: questions.length,
          status: set.status,
          myBestAttempt: this.mapBestAttempt(best),
          myPendingAttempt: this.mapPendingAttempt(pending),
          myRank,
          // Student-safe: no isCorrect / explanation
          quizQuestions: questions.map((q) => ({
            id: q.id,
            question: q.question,
            position: q.position,
            options: [...(q.options ?? [])]
              .sort((a, b) => a.position - b.position)
              .map((o) => ({
                id: o.id,
                text: o.text,
                position: o.position,
              })),
          })),
        },
      };
    }

    const revisions = await this.repo.findRevisionQuestionsForSet(setId);

    return {
      learningSet: {
        id: set.id,
        title: set.title,
        generationType: set.generationType,
        difficulty: set.difficulty,
        subjectName: set.subject?.name ?? null,
        yearGroup: set.yearGroup,
        termName: set.term?.name ?? null,
        revisionQuestions: revisions.map((r) => ({
          id: r.id,
          question: r.question,
          answer: r.answer,
          position: r.position,
        })),
      },
    };
  }

  async updateFlashcardProgress(
    studentId: string,
    flashcardId: string,
    status: FlashcardProgressStatus,
  ) {
    const card = await this.repo.findFlashcardById(flashcardId);
    if (!card) throw new AppError(404, "Flashcard not found", "NOT_FOUND");
    await this.assertPublishedAccess(studentId, card.learningSetId);

    let row = await this.repo.findProgress(studentId, flashcardId);
    if (!row) {
      row = this.repo.createProgress({ studentId, flashcardId, status });
    } else {
      row.status = status;
    }
    row.lastReviewedAt = new Date();
    await this.repo.saveProgress(row);

    return {
      progress: {
        flashcardId,
        status: row.status,
        lastReviewedAt: row.lastReviewedAt.toISOString(),
      },
    };
  }

  async startQuizAttempt(studentId: string, setId: string) {
    const set = await this.assertPublishedAccess(studentId, setId);
    if (set.generationType !== "quiz") {
      throw new AppError(400, "Not a quiz learning set", "INVALID_TYPE");
    }

    const incomplete = await this.repo.findIncompleteAttempt(studentId, setId);
    if (incomplete) {
      return {
        attempt: {
          id: incomplete.id,
          startedAt: incomplete.startedAt.toISOString(),
        },
      };
    }

    const totalQuestions = await this.repo.countQuizQuestions(setId);
    const mpq = Number(set.marksPerQuestion) || 1;
    const attempt = await this.repo.createAttempt({
      learningSetId: setId,
      studentId,
      score: "0",
      totalMarks: String(totalQuestions * mpq),
      correctCount: 0,
      totalQuestions,
      percentage: null,
      startedAt: new Date(),
      completedAt: null,
    });

    return {
      attempt: { id: attempt.id, startedAt: attempt.startedAt.toISOString() },
    };
  }

  async completeQuizAttempt(
    studentId: string,
    attemptId: string,
    answers: Array<{ questionId: string; selectedOptionId: string | null }>,
  ) {
    const attempt = await this.repo.findAttemptForStudent(attemptId, studentId);
    if (!attempt) throw new AppError(404, "Attempt not found", "NOT_FOUND");
    if (attempt.completedAt) {
      throw new AppError(400, "Attempt already completed", "ALREADY_COMPLETED");
    }

    await this.assertLearningAccess(studentId, attempt.learningSetId, "continue");

    const questions = await this.repo.findQuizQuestionsForSet(
      attempt.learningSetId,
    );

    const answerMap = new Map(
      answers.map((a) => [a.questionId, a.selectedOptionId]),
    );
    const mpq = Number(attempt.learningSet?.marksPerQuestion ?? 1) || 1;

    let correctCount = 0;
    const answerRows: Array<{
      questionId: string;
      selectedOptionId: string | null;
      isCorrect: boolean;
    }> = [];

    for (const question of questions) {
      const selectedOptionId = answerMap.get(question.id) ?? null;
      const correctOption = (question.options ?? []).find((o) => o.isCorrect);
      const isCorrect =
        Boolean(selectedOptionId) &&
        correctOption?.id === selectedOptionId;

      if (isCorrect) correctCount += 1;
      answerRows.push({
        questionId: question.id,
        selectedOptionId,
        isCorrect,
      });
    }

    const score = correctCount * mpq;
    const totalMarks = questions.length * mpq;
    const percentage =
      totalMarks > 0 ? Math.round((score / totalMarks) * 10000) / 100 : 0;

    attempt.score = String(score);
    attempt.totalMarks = String(totalMarks);
    attempt.correctCount = correctCount;
    attempt.totalQuestions = questions.length;
    attempt.percentage = String(percentage);
    attempt.completedAt = new Date();
    attempt.reviewSnapshot = questions.map((q) => {
      const selected = answerRows.find((r) => r.questionId === q.id);
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
        selectedOptionId: selected?.selectedOptionId ?? null,
        correctOptionId: correct?.id ?? null,
        isCorrect: selected?.isCorrect ?? false,
      };
    });

    await this.repo.saveCompletedAttemptWithAnswers({
      attempt,
      answers: answerRows,
    });

    const leaderboard = await teacherLearningService.buildLeaderboard(
      attempt.learningSetId,
    );
    const myEntry = leaderboard.leaderboard.find(
      (row) => row.studentId === studentId,
    );

    return {
      result: {
        attemptId: attempt.id,
        score,
        totalMarks,
        correctCount,
        totalQuestions: questions.length,
        percentage,
        rank: myEntry?.rank ?? null,
        isWinner: myEntry?.isWinner ?? false,
        completedAt: attempt.completedAt.toISOString(),
      },
      review: attempt.reviewSnapshot,
      leaderboard: leaderboard.leaderboard.slice(0, 20),
    };
  }

  async getAttemptResult(studentId: string, attemptId: string) {
    const attempt = await this.repo.findAttemptByIdForStudent(
      attemptId,
      studentId,
    );
    if (!attempt || !attempt.completedAt) {
      throw new AppError(404, "Completed attempt not found", "NOT_FOUND");
    }

    // Completed attempts remain viewable even if the teacher later unpublishes/edits.
    const set = await this.repo.findSetById(attempt.learningSetId);
    if (!set) {
      throw new AppError(404, "Learning set not found", "LEARNING_SET_NOT_FOUND");
    }
    const scopes = await this.enrollmentScopes(studentId);
    const allowed = scopes.some(
      (scope) =>
        scope.termId === set.termId && scope.subjectId === set.subjectId,
    );
    if (!allowed) {
      throw new AppError(403, "Forbidden", "FORBIDDEN");
    }

    const leaderboard = await teacherLearningService.buildLeaderboard(
      attempt.learningSetId,
    );
    const myEntry = leaderboard.leaderboard.find(
      (row) => row.studentId === studentId,
    );

    let review = attempt.reviewSnapshot;
    if (!review || review.length === 0) {
      const [answers, questions] = await Promise.all([
        this.repo.findAnswersForAttempt(attemptId),
        this.repo.findQuizQuestionsForSet(attempt.learningSetId),
      ]);
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
      result: {
        attemptId: attempt.id,
        score: Number(attempt.score),
        totalMarks: Number(attempt.totalMarks),
        correctCount: attempt.correctCount,
        totalQuestions: attempt.totalQuestions,
        percentage:
          attempt.percentage != null ? Number(attempt.percentage) : null,
        rank: myEntry?.rank ?? null,
        isWinner: myEntry?.isWinner ?? false,
        completedAt: attempt.completedAt.toISOString(),
      },
      review,
      leaderboard: leaderboard.leaderboard.slice(0, 20),
    };
  }

  async getLeaderboard(studentId: string, setId: string) {
    await this.assertLearningAccess(studentId, setId, "continue");
    const set = await this.repo.findSetByIdOrFail(setId);
    if (set.generationType !== "quiz") {
      throw new AppError(400, "Not a quiz learning set", "INVALID_TYPE");
    }
    const board = await teacherLearningService.buildLeaderboard(setId);
    const myEntry = board.leaderboard.find((row) => row.studentId === studentId);
    return {
      ...board,
      myRank: myEntry?.rank ?? null,
      myScore: myEntry?.score ?? null,
    };
  }
}

export const studentLearningService = new StudentLearningService();
