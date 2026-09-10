import { In, IsNull, MoreThanOrEqual, Not } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import {
  Assessment,
  AssessmentStudent,
  AssessmentSubmission,
  AttendanceRecord,
  AttendanceStatus,
  Session,
} from "../../../entities/index.js";
import { AttendanceRepository } from "../../shared/attendance/attendance.repository.js";
import {
  buildClassJoinAtMap,
  isStudentAccountableForSession,
} from "../../shared/attendance/student-session-eligibility.js";
import {
  studentClassesService,
  type StudentLessonDto,
} from "../../student/classes/student-classes.service.js";
import { studentEntranceExamsService } from "../../student/entrance-exams/student-entrance-exams.service.js";
import { AppError } from "../../../common/errors/AppError.js";
import { resolveLinkedStudentForGuardian } from "../shared/guardian-student-access.js";

function sanitizeLesson(lesson: StudentLessonDto): StudentLessonDto {
  return {
    ...lesson,
    canCheckIn: false,
    resources: lesson.resources.map((resource) => ({
      ...resource,
      downloadable: false,
    })),
  };
}

function sanitizeTimetable(data: Awaited<
  ReturnType<typeof studentClassesService.getTimetable>
>) {
  return {
    ...data,
    nextLesson: data.nextLesson ? sanitizeLesson(data.nextLesson) : null,
    today: data.today.map(sanitizeLesson),
    week: data.week.map(sanitizeLesson),
    lessons: data.lessons.map(sanitizeLesson),
  };
}

function sanitizeSubmission(submission: AssessmentSubmission, assessment: Assessment | null) {
  return {
    id: submission.id,
    assessmentId: submission.assessmentId,
    studentId: submission.studentId,
    status: submission.status,
    submittedAt: submission.submittedAt?.toISOString() ?? null,
    mark: submission.mark != null ? Number(submission.mark) : null,
    markNotes: submission.markNotes ?? null,
    markedAt: submission.markedAt?.toISOString() ?? null,
    files: (submission.files ?? [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((file) => ({
        id: file.id,
        originalName: file.originalName,
        mimeType: file.mimeType,
        byteSize: file.byteSize,
        sortOrder: file.sortOrder,
      })),
    assessment: assessment
      ? {
          id: assessment.id,
          name: assessment.name,
          subject: assessment.subject,
          yearGroup: assessment.yearGroup,
          termId: assessment.termId,
          termLabel: assessment.term?.name ?? "",
          assessmentDate: assessment.assessmentDate,
          startTime: assessment.startTime,
          durationMinutes: assessment.durationMinutes,
          kind: assessment.kind,
          totalMarks:
            assessment.totalMarks != null ? Number(assessment.totalMarks) : null,
          cutOffMarks:
            assessment.cutOffMarks != null ? Number(assessment.cutOffMarks) : null,
        }
      : null,
  };
}

function attendanceStatusLabel(status: AttendanceStatus | null) {
  if (!status) return "Not recorded";
  if (status === AttendanceStatus.PRESENT) return "Present";
  if (status === AttendanceStatus.LATE) return "Late";
  if (status === AttendanceStatus.EXCUSED) return "Excused";
  if (status === AttendanceStatus.ABSENT) return "Absent";
  if (status === AttendanceStatus.EXCEPTION) return "Exception";
  return status;
}

export class GuardianAcademicsService {
  private readonly repo = new AttendanceRepository();
  private readonly submissions = AppDataSource.getRepository(AssessmentSubmission);
  private readonly assessments = AppDataSource.getRepository(Assessment);
  private readonly assessmentStudents =
    AppDataSource.getRepository(AssessmentStudent);

  private async softCall<T>(
    run: () => Promise<T>,
  ): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
    try {
      return { ok: true, data: await run() };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof AppError ? error.message : "Unavailable",
      };
    }
  }

  async getTimetable(guardianUserId: string, studentEntityId: string) {
    const { studentUserId } = await resolveLinkedStudentForGuardian(
      guardianUserId,
      studentEntityId,
      ["classDetails", "assessments"],
    );
    const data = await studentClassesService.getTimetable(studentUserId);
    return sanitizeTimetable(data);
  }

  async getLesson(
    guardianUserId: string,
    studentEntityId: string,
    sessionId: string,
  ) {
    const { studentUserId } = await resolveLinkedStudentForGuardian(
      guardianUserId,
      studentEntityId,
      ["classDetails", "assessments"],
    );
    const lesson = await studentClassesService.getLesson(studentUserId, sessionId);
    return { lesson: sanitizeLesson(lesson) };
  }

  async getAssessmentSubmission(
    guardianUserId: string,
    studentEntityId: string,
    assessmentId: string,
  ) {
    const { studentUserId } = await resolveLinkedStudentForGuardian(
      guardianUserId,
      studentEntityId,
      "assessments",
    );

    const submission = await this.submissions.findOne({
      where: { assessmentId, studentId: studentUserId },
      relations: { files: true },
    });
    if (!submission || submission.status === "DRAFT") {
      return { submission: null };
    }

    const assessment = await this.assessments.findOne({
      where: { id: assessmentId },
      relations: { term: true },
    });

    return { submission: sanitizeSubmission(submission, assessment) };
  }

  async listEntranceExams(guardianUserId: string, studentEntityId: string) {
    const { studentUserId } = await resolveLinkedStudentForGuardian(
      guardianUserId,
      studentEntityId,
      "entranceExams",
    );
    return studentEntranceExamsService.listAvailable(studentUserId);
  }

  async getEntranceExamSubmission(
    guardianUserId: string,
    studentEntityId: string,
    assessmentId: string,
  ) {
    const { studentUserId } = await resolveLinkedStudentForGuardian(
      guardianUserId,
      studentEntityId,
      "entranceExams",
    );

    const submission = await this.submissions.findOne({
      where: { assessmentId, studentId: studentUserId },
      relations: { files: true },
    });
    if (!submission || submission.status === "DRAFT") {
      return { submission: null };
    }

    const assessment = await this.assessments.findOne({
      where: { id: assessmentId },
      relations: { term: true },
    });

    return { submission: sanitizeSubmission(submission, assessment) };
  }

  async getAttendance(guardianUserId: string, studentEntityId: string) {
    const { studentUserId } = await resolveLinkedStudentForGuardian(
      guardianUserId,
      studentEntityId,
      "attendance",
    );

    const enrols = await this.repo.findEnrolmentsByStudentId(studentUserId);
    const classIds = enrols.map((row) => row.classId);
    if (classIds.length === 0) {
      return { records: [], stats: { attendancePercent: null } };
    }

    const joinAtByClassId = buildClassJoinAtMap(enrols);

    const since = new Date();
    since.setDate(since.getDate() - 90);
    since.setHours(0, 0, 0, 0);

    const sessions = await AppDataSource.getRepository(Session).find({
      where: {
        classId: In(classIds),
        assessmentId: IsNull(),
        startAt: MoreThanOrEqual(since),
      },
      relations: { class: true },
      order: { startAt: "DESC" },
    });

    const accountableSessions = sessions.filter((session) => {
      if (!session.classId) return false;
      const joinedAt = joinAtByClassId.get(session.classId);
      return Boolean(
        joinedAt && isStudentAccountableForSession(session, joinedAt),
      );
    });

    const attendanceRecords = await this.repo.findAttendanceRecordsByStudentId(
      studentUserId,
    );
    const bySession = new Map(
      attendanceRecords.map((record) => [record.sessionId, record]),
    );

    const now = Date.now();
    const ended = accountableSessions.filter(
      (session) => new Date(session.endAt).getTime() < now,
    );
    const attended = ended.filter((session) => {
      const record = bySession.get(session.id);
      return (
        record?.status === AttendanceStatus.PRESENT ||
        record?.status === AttendanceStatus.LATE ||
        record?.status === AttendanceStatus.EXCUSED
      );
    });

    return {
      records: accountableSessions.map((session) => {
        const record = bySession.get(session.id) as AttendanceRecord | undefined;
        return {
          sessionId: session.id,
          className: session.class?.name ?? session.class?.code ?? "Class",
          room: session.class?.room ?? null,
          startAt: session.startAt.toISOString(),
          endAt: session.endAt.toISOString(),
          status: record?.status ?? null,
          statusLabel: attendanceStatusLabel(record?.status ?? null),
          scannedAt: record?.scannedAt?.toISOString() ?? null,
        };
      }),
      stats: {
        attendancePercent:
          ended.length > 0
            ? Math.round((attended.length / ended.length) * 100)
            : null,
      },
    };
  }

  async listHomework(guardianUserId: string, studentEntityId: string) {
    const { studentUserId } = await resolveLinkedStudentForGuardian(
      guardianUserId,
      studentEntityId,
      "classDetails",
    );
    const data = await studentClassesService.listHomework(studentUserId);
    return {
      homework: data.homework.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        dueDate: row.dueDate,
        subject: row.subject,
        term: row.term,
        yearGroup: row.yearGroup,
        submissionStatus: row.submission?.status ?? "NOT_STARTED",
        submittedAt: row.submission?.submittedAt ?? null,
        filesCount: row.submission?.filesCount ?? 0,
      })),
    };
  }

  async getHomeworkStatus(
    guardianUserId: string,
    studentEntityId: string,
    homeworkId: string,
  ) {
    const data = await this.listHomework(guardianUserId, studentEntityId);
    const homework = data.homework.find((row) => row.id === homeworkId) ?? null;
    return { homework };
  }

  async listAssessmentResults(
    guardianUserId: string,
    studentEntityId: string,
  ) {
    const { studentUserId } = await resolveLinkedStudentForGuardian(
      guardianUserId,
      studentEntityId,
      "assessments",
    );

    const links = await this.assessmentStudents.find({
      where: { studentId: studentUserId },
      relations: { assessment: { term: true } },
      order: { createdAt: "DESC" },
      take: 80,
    });

    const schoolLinks = links.filter(
      (link) =>
        link.assessment &&
        link.assessment.kind === "SCHOOL" &&
        link.assessment.status !== "ARCHIVED" &&
        link.assessment.status !== "CANCELLED",
    );

    const assessmentIds = schoolLinks.map((link) => link.assessmentId);
    const submissions =
      assessmentIds.length === 0
        ? []
        : await this.submissions.find({
            where: {
              studentId: studentUserId,
              assessmentId: In(assessmentIds),
              status: Not("DRAFT" as AssessmentSubmission["status"]),
            },
          });
    const byAssessment = new Map(
      submissions.map((row) => [row.assessmentId, row]),
    );

    return {
      assessments: schoolLinks.map((link) => {
        const assessment = link.assessment;
        const submission = byAssessment.get(link.assessmentId);
        return {
          assessmentId: assessment.id,
          name: assessment.name,
          subject: assessment.subject,
          yearGroup: assessment.yearGroup,
          termLabel: assessment.term?.name ?? null,
          assessmentDate: assessment.assessmentDate,
          kind: assessment.kind,
          totalMarks:
            assessment.totalMarks != null ? Number(assessment.totalMarks) : null,
          cutOffMarks:
            assessment.cutOffMarks != null
              ? Number(assessment.cutOffMarks)
              : null,
          submission: submission
            ? {
                status: submission.status,
                submittedAt: submission.submittedAt?.toISOString() ?? null,
                mark:
                  submission.mark != null ? Number(submission.mark) : null,
                markNotes: submission.markNotes ?? null,
                markedAt: submission.markedAt?.toISOString() ?? null,
              }
            : null,
        };
      }),
    };
  }

  async getUpcoming(guardianUserId: string, studentEntityId: string) {
    const { studentUserId } = await resolveLinkedStudentForGuardian(
      guardianUserId,
      studentEntityId,
      ["classDetails", "assessments"],
    );
    const data = await studentClassesService.listUpcomingSessions(
      studentUserId,
      { range: "initial" },
    );
    if (data.range !== "initial") {
      return {
        today: [] as StudentLessonDto[],
        thisWeek: [] as StudentLessonDto[],
        nextWeek: [] as StudentLessonDto[],
        hasMoreWeeks: false,
        nextWeekStart: null as string | null,
      };
    }
    return {
      today: data.today.map(sanitizeLesson),
      thisWeek: data.thisWeek.map(sanitizeLesson),
      nextWeek: data.nextWeek.map(sanitizeLesson),
      hasMoreWeeks: data.hasMoreWeeks,
      nextWeekStart: data.nextWeekStart,
    };
  }

  async getScheduleForRange(
    guardianUserId: string,
    studentEntityId: string,
    startDate: string,
    endDate: string,
  ) {
    const { studentUserId } = await resolveLinkedStudentForGuardian(
      guardianUserId,
      studentEntityId,
      ["classDetails", "assessments"],
    );

    const start = startDate.slice(0, 10);
    const end = endDate.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      throw new AppError(400, "Invalid date range", "VALIDATION_ERROR");
    }
    if (start > end) {
      throw new AppError(
        400,
        "startDate must be on or before endDate",
        "VALIDATION_ERROR",
      );
    }

    const [upcoming, past] = await Promise.all([
      studentClassesService.listUpcomingSessions(studentUserId, {
        range: "initial",
      }),
      studentClassesService.listPastSessions(studentUserId, {
        page: 1,
        limit: 50,
      }),
    ]);

    const byId = new Map<string, StudentLessonDto>();
    if (upcoming.range === "initial") {
      for (const lesson of [
        ...upcoming.today,
        ...upcoming.thisWeek,
        ...upcoming.nextWeek,
      ]) {
        byId.set(lesson.sessionId, sanitizeLesson(lesson));
      }
    }
    for (const lesson of past.sessions) {
      byId.set(lesson.sessionId, sanitizeLesson(lesson));
    }

    // Also pull specific weeks when range extends beyond the initial window.
    let weekStart = mondayOf(start);
    for (let i = 0; i < 6; i += 1) {
      if (weekStart > end) break;
      try {
        const week = await studentClassesService.listUpcomingSessions(
          studentUserId,
          { range: "week", weekStart },
        );
        if (week.range !== "week") break;
        for (const lesson of week.sessions) {
          byId.set(lesson.sessionId, sanitizeLesson(lesson));
        }
        weekStart = week.nextWeekStart ?? addDays(week.weekEnd, 1);
        if (!week.hasMoreWeeks && weekStart > end) break;
      } catch {
        break;
      }
    }

    const lessons = [...byId.values()]
      .filter((lesson) => {
        const key = lesson.startAt.slice(0, 10);
        return key >= start && key <= end;
      })
      .sort((a, b) => a.startAt.localeCompare(b.startAt));

    return {
      startDate: start,
      endDate: end,
      lessons,
      lessonCount: lessons.length,
    };
  }

  async getAbsenceDetail(
    guardianUserId: string,
    studentEntityId: string,
    date?: string | null,
  ) {
    const attendance = await this.getAttendance(guardianUserId, studentEntityId);
    const dateKey = date?.slice(0, 10) ?? null;
    const absences = attendance.records.filter((row) => {
      const isAbsence =
        row.status === AttendanceStatus.ABSENT ||
        row.status === AttendanceStatus.EXCEPTION ||
        (row.status == null && new Date(row.endAt).getTime() < Date.now());
      if (!isAbsence) return false;
      if (!dateKey) return true;
      return row.startAt.slice(0, 10) === dateKey;
    });

    return {
      dateFilter: dateKey,
      attendancePercent: attendance.stats.attendancePercent,
      absences: absences.slice(0, 60),
      absenceCount: absences.length,
    };
  }

  async getPerformanceSummary(
    guardianUserId: string,
    studentEntityId: string,
  ) {
    const [attendanceResult, homeworkResult, assessmentsResult, upcomingResult, entranceResult] =
      await Promise.all([
        this.softCall(() => this.getAttendance(guardianUserId, studentEntityId)),
        this.softCall(() => this.listHomework(guardianUserId, studentEntityId)),
        this.softCall(() =>
          this.listAssessmentResults(guardianUserId, studentEntityId),
        ),
        this.softCall(() => this.getUpcoming(guardianUserId, studentEntityId)),
        this.softCall(() =>
          this.listEntranceExams(guardianUserId, studentEntityId),
        ),
      ]);

    const homework = homeworkResult.ok ? homeworkResult.data.homework : [];
    const now = Date.now();
    const overdue = homework.filter((row) => {
      const due = new Date(row.dueDate).getTime();
      return (
        Number.isFinite(due) &&
        due < now &&
        row.submissionStatus !== "SUBMITTED"
      );
    });
    const submitted = homework.filter(
      (row) => row.submissionStatus === "SUBMITTED",
    );

    const assessments = assessmentsResult.ok
      ? assessmentsResult.data.assessments
      : [];
    const marked = assessments.filter((row) => row.submission?.mark != null);
    const recentMarks = marked.slice(0, 8).map((row) => ({
      assessmentId: row.assessmentId,
      name: row.name,
      subject: row.subject,
      mark: row.submission?.mark ?? null,
      totalMarks: row.totalMarks,
      assessmentDate: row.assessmentDate,
    }));

    const avgMark =
      recentMarks.length > 0
        ? Math.round(
            (recentMarks.reduce((sum, row) => sum + Number(row.mark ?? 0), 0) /
              recentMarks.length) *
              10,
          ) / 10
        : null;

    return {
      blocker:
        !attendanceResult.ok &&
        !homeworkResult.ok &&
        !assessmentsResult.ok &&
        !upcomingResult.ok &&
        attendanceResult.error.includes("login")
          ? {
              code: "STUDENT_LOGIN_MISSING",
              message:
                "This child does not have a student login account yet. Enrolment/fee details are available, but timetable, attendance, homework, and assessment data require a student login. Ask the guardian to set a username/password for the child (or create the student account from admin).",
            }
          : !attendanceResult.ok &&
              !homeworkResult.ok &&
              !assessmentsResult.ok &&
              !upcomingResult.ok
            ? {
                code: "ACADEMICS_UNAVAILABLE",
                message:
                  attendanceResult.error ||
                  homeworkResult.error ||
                  assessmentsResult.error ||
                  upcomingResult.error,
              }
            : null,
      attendance: attendanceResult.ok
        ? {
            attendancePercent: attendanceResult.data.stats.attendancePercent,
            recentRecords: attendanceResult.data.records.slice(0, 10),
          }
        : { unavailable: attendanceResult.error },
      homework: homeworkResult.ok
        ? {
            total: homework.length,
            submitted: submitted.length,
            overdue: overdue.length,
            upcomingDue: homework
              .filter((row) => new Date(row.dueDate).getTime() >= now)
              .slice(0, 8),
          }
        : { unavailable: homeworkResult.error },
      assessments: assessmentsResult.ok
        ? {
            total: assessments.length,
            marked: marked.length,
            averageRecentMark: avgMark,
            recentMarks,
          }
        : { unavailable: assessmentsResult.error },
      upcoming: upcomingResult.ok
        ? {
            todayCount: upcomingResult.data.today.length,
            thisWeekCount: upcomingResult.data.thisWeek.length,
            nextLesson: upcomingResult.data.today[0] ??
              upcomingResult.data.thisWeek[0] ??
              null,
          }
        : { unavailable: upcomingResult.error },
      entranceExams: entranceResult.ok
        ? entranceResult.data
        : { unavailable: entranceResult.error },
    };
  }
}

function mondayOf(dateStr: string) {
  const date = new Date(`${dateStr}T12:00:00.000Z`);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number) {
  const date = new Date(`${dateStr}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export const guardianAcademicsService = new GuardianAcademicsService();
