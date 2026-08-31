import { Brackets, In, IsNull } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import { EnrollmentStatus } from "../../../common/constants/enrollment.js";
import { AppError } from "../../../common/errors/AppError.js";
import {
  parseDayTime,
  resolveIanaTimeZone,
} from "../../../common/utils/timezone.js";
import {
  buildHomeworkSubmissionKey,
  deleteObject,
  getObjectBuffer,
  putObject,
} from "../../../common/storage/object-storage.js";
import {
  termYearLevelNumber,
  yearLevelsCompatible,
} from "../../../common/utils/year-level.js";
import {
  Assessment,
  AssessmentResource,
  AssessmentStudent,
  AttendanceRecord,
  AttendanceStatus,
  Class,
  ClassStudent,
  Enrollment,
  Homework,
  HomeworkAttachment,
  HomeworkStudent,
  HomeworkSubmission,
  HomeworkSubmissionFile,
  Session,
  Student,
  type AssessmentScheduleType,
} from "../../../entities/index.js";
import {
  assessmentScheduleWindow,
  assessmentSessionSyncService,
  resolveAssessmentTimeZone,
} from "../../admin/assessments/assessment-session-sync.service.js";

export type StudentLessonKind = "class" | "assessment";

export type StudentLessonStatus =
  | "ATTENDED"
  | "LIVE"
  | "SOON"
  | "UPCOMING"
  | "ONLINE"
  | "MISSED"
  | "PENDING_REVIEW"
  | "AWAITING_ADMIN";

export type StudentLessonDto = {
  sessionId: string;
  kind: StudentLessonKind;
  scheduleType?: AssessmentScheduleType;
  assessmentId?: string;
  classId: string;
  subject: string;
  className: string;
  room: string;
  teacher: string | null;
  startAt: string;
  endAt: string;
  term: string | null;
  termName: string | null;
  yearLevel: string | null;
  weekLabel: string;
  topic: string;
  homework: {
    title: string;
    dueAt: string;
  } | null;
  status: StudentLessonStatus;
  minutesUntilStart: number | null;
  checkedInAt: string | null;
  isOnline: boolean;
  canCheckIn: boolean;
  timeZone: string;
  resources: {
    id: string;
    title: string;
    kind: "SLIDES" | "WORKSHEET" | "RECORDING" | "PAPER" | "DOCUMENT";
    releasedAt: string;
    released: boolean;
    downloadable?: boolean;
  }[];
};

export type UploadedHomeworkAnswerFile = {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  size: number;
};

export type StudentHomeworkSubmissionSummaryDto = {
  id: string;
  status: "DRAFT" | "SUBMITTED";
  submittedAt: string | null;
  filesCount: number;
};

export type StudentHomeworkDto = {
  id: string;
  title: string;
  description: string | null;
  dueDate: string;
  subject: string | null;
  term: string | null;
  yearGroup: string;
  attachments: {
    id: string;
    originalName: string;
    mimeType: string;
    byteSize: number;
  }[];
  submission: StudentHomeworkSubmissionSummaryDto | null;
};

const EXCLUDED_ASSESSMENT_STATUSES = ["ARCHIVED", "CANCELLED"] as const;

type StudentTimetableContext = {
  classIds: Set<string>;
  subjectKeys: Set<string>;
  yearGroupKeys: Set<string>;
  academicYears: Set<number>;
  linkedAssessmentIds: Set<string>;
};

function parseClassTimes(
  dayTime: string | null,
  timeZone?: string | null,
): {
  startAt: Date;
  endAt: Date;
} | null {
  return parseDayTime(dayTime, timeZone, 90);
}

function yearGroupKey(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function yearGroupNumber(value: string | null | undefined): number | null {
  const match = (value ?? "").trim().match(/(\d+)/);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) ? num : null;
}

function isOnlineRoom(room: string | null | undefined) {
  const value = (room ?? "").toLowerCase();
  return value.includes("zoom") || value.includes("online");
}

function lessonStatus(input: {
  startAt: Date;
  endAt: Date;
  attendanceStatus: AttendanceStatus | null;
  scannedAt: Date | null;
  online: boolean;
  now: Date;
}): { status: StudentLessonStatus; minutesUntilStart: number | null; canCheckIn: boolean } {
  const minutesUntilStart = Math.round(
    (input.startAt.getTime() - input.now.getTime()) / 60_000,
  );
  const inWindow =
    input.now.getTime() >= input.startAt.getTime() - 15 * 60_000 &&
    input.now.getTime() <= input.endAt.getTime();

  if (
    input.attendanceStatus === AttendanceStatus.PRESENT ||
    input.attendanceStatus === AttendanceStatus.LATE ||
    input.attendanceStatus === AttendanceStatus.EXCUSED
  ) {
    return { status: "ATTENDED", minutesUntilStart, canCheckIn: false };
  }
  if (input.attendanceStatus === AttendanceStatus.EXCEPTION) {
    return { status: "PENDING_REVIEW", minutesUntilStart, canCheckIn: false };
  }
  if (input.attendanceStatus === AttendanceStatus.ABSENT && input.scannedAt) {
    return { status: "AWAITING_ADMIN", minutesUntilStart, canCheckIn: false };
  }
  if (input.now.getTime() > input.endAt.getTime()) {
    return { status: "MISSED", minutesUntilStart: null, canCheckIn: false };
  }
  if (
    input.now.getTime() >= input.startAt.getTime() &&
    input.now.getTime() <= input.endAt.getTime()
  ) {
    return { status: "LIVE", minutesUntilStart: 0, canCheckIn: true };
  }
  if (minutesUntilStart > 0 && minutesUntilStart <= 45) {
    return { status: "SOON", minutesUntilStart, canCheckIn: inWindow };
  }
  if (input.online) {
    return { status: "ONLINE", minutesUntilStart, canCheckIn: inWindow };
  }
  return {
    status: "UPCOMING",
    minutesUntilStart,
    canCheckIn: inWindow,
  };
}

function weekLabelFor(startAt: Date, termStart?: string | null) {
  if (!termStart) {
    return "This week";
  }
  const termBegin = new Date(`${termStart}T00:00:00`);
  if (Number.isNaN(termBegin.getTime())) return "This week";
  const diffDays = Math.floor(
    (startAt.getTime() - termBegin.getTime()) / (24 * 60 * 60_000),
  );
  const week = Math.max(1, Math.floor(diffDays / 7) + 1);
  return `Week ${week}`;
}

function buildResources(subject: string, startAt: Date, endAt: Date, now: Date) {
  const slidesAt = new Date(startAt.getTime() - 2 * 60 * 60_000);
  const paperAt = new Date(startAt.getTime() + 60 * 60_000);
  const recordingAt = new Date(endAt.getTime() + 30 * 60_000);
  return [
    {
      id: "slides",
      title: `${subject} — annotated slides`,
      kind: "SLIDES" as const,
      releasedAt: slidesAt.toISOString(),
      released: now.getTime() >= slidesAt.getTime(),
    },
    {
      id: "paper",
      title: "Past paper practice",
      kind: "PAPER" as const,
      releasedAt: paperAt.toISOString(),
      released: now.getTime() >= paperAt.getTime(),
    },
    {
      id: "recording",
      title: "Lesson recording",
      kind: "RECORDING" as const,
      releasedAt: recordingAt.toISOString(),
      released: now.getTime() >= recordingAt.getTime(),
    },
  ];
}

export class StudentClassesService {
  private readonly students = AppDataSource.getRepository(Student);
  private readonly enrollments = AppDataSource.getRepository(Enrollment);
  private readonly classes = AppDataSource.getRepository(Class);
  private readonly classStudents = AppDataSource.getRepository(ClassStudent);
  private readonly sessions = AppDataSource.getRepository(Session);
  private readonly attendance = AppDataSource.getRepository(AttendanceRecord);
  private readonly assessments = AppDataSource.getRepository(Assessment);
  private readonly assessmentResources =
    AppDataSource.getRepository(AssessmentResource);
  private readonly assessmentStudents =
    AppDataSource.getRepository(AssessmentStudent);
  private readonly homework = AppDataSource.getRepository(Homework);
  private readonly homeworkAttachments =
    AppDataSource.getRepository(HomeworkAttachment);
  private readonly homeworkStudents =
    AppDataSource.getRepository(HomeworkStudent);
  private readonly homeworkSubmissions =
    AppDataSource.getRepository(HomeworkSubmission);
  private readonly homeworkSubmissionFiles =
    AppDataSource.getRepository(HomeworkSubmissionFile);

  async getTimetable(userId: string) {
    const lessons = await this.listLessons(userId);
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);
    const startOfWeek = new Date(startOfToday);
    const weekday = startOfWeek.getDay();
    const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
    startOfWeek.setDate(startOfWeek.getDate() - daysFromMonday);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    const upcoming = lessons.filter(
      (lesson) => new Date(lesson.endAt).getTime() >= now.getTime(),
    );
    const nextLesson = upcoming[0] ?? null;
    const today = lessons.filter((lesson) => {
      const start = new Date(lesson.startAt).getTime();
      return start >= startOfToday.getTime() && start < endOfToday.getTime();
    });
    const week = lessons.filter((lesson) => {
      const start = new Date(lesson.startAt).getTime();
      return start >= startOfWeek.getTime() && start < endOfWeek.getTime();
    });
    const fromThisWeek = lessons.filter((lesson) => {
      const start = new Date(lesson.startAt).getTime();
      return start >= startOfWeek.getTime();
    });

    const ended = lessons.filter(
      (lesson) =>
        lesson.kind === "class" &&
        new Date(lesson.endAt).getTime() < now.getTime(),
    );
    const twoWeeksAgo = new Date(startOfToday);
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const needsYou = ended.filter((lesson) => {
      if (lesson.status !== "MISSED") return false;
      return new Date(lesson.startAt).getTime() >= twoWeeksAgo.getTime();
    }).length;
    const attendedCount = ended.filter(
      (lesson) => lesson.status === "ATTENDED",
    ).length;
    const dueThisWeek = lessons.filter((lesson) => {
      if (!lesson.homework) return false;
      const due = new Date(lesson.homework.dueAt).getTime();
      return due >= startOfToday.getTime() && due < endOfWeek.getTime();
    }).length;
    const dueTomorrow = lessons.filter((lesson) => {
      if (!lesson.homework) return false;
      const due = new Date(lesson.homework.dueAt).getTime();
      const tomorrow = new Date(startOfToday);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dayAfter = new Date(tomorrow);
      dayAfter.setDate(dayAfter.getDate() + 1);
      return due >= tomorrow.getTime() && due < dayAfter.getTime();
    }).length;

    const term =
      nextLesson?.termName ??
      week[0]?.termName ??
      fromThisWeek[0]?.termName ??
      nextLesson?.term ??
      week[0]?.term ??
      fromThisWeek[0]?.term ??
      null;
    const weekLabel =
      week[0]?.weekLabel ??
      fromThisWeek[0]?.weekLabel ??
      nextLesson?.weekLabel ??
      null;

    return {
      term,
      weekLabel,
      nextLesson,
      today,
      week,
      lessons: fromThisWeek,
      stats: {
        dueThisWeek,
        dueTomorrow,
        attendancePercent:
          ended.length > 0
            ? Math.round((attendedCount / ended.length) * 100)
            : null,
        newMarks: 0,
        needsYou,
      },
    };
  }

  async getLesson(userId: string, sessionId: string) {
    const lessons = await this.listLessons(userId);
    const lesson = lessons.find((item) => item.sessionId === sessionId);
    if (!lesson) {
      throw new AppError(404, "Lesson not found", "LESSON_NOT_FOUND");
    }
    return lesson;
  }

  async listHomework(userId: string): Promise<{ homework: StudentHomeworkDto[] }> {
    const rows = await this.homework
      .createQueryBuilder("homework")
      .innerJoin("homework.students", "student", "student.studentId = :userId", {
        userId,
      })
      .leftJoinAndSelect("homework.attachments", "attachments")
      .leftJoinAndSelect("homework.subject", "subject")
      .leftJoinAndSelect("homework.term", "term")
      .leftJoinAndSelect("term.academicYear", "academicYear")
      .leftJoinAndSelect("term.yearLevel", "yearLevel")
      .leftJoinAndSelect(
        "homework.submissions",
        "submissions",
        "submissions.studentId = :userId",
        { userId },
      )
      .leftJoinAndSelect("submissions.files", "submissionFiles")
      .orderBy("homework.dueDate", "ASC")
      .addOrderBy("homework.createdAt", "DESC")
      .getMany();

    return { homework: rows.map((row) => this.toStudentHomeworkDto(row, userId)) };
  }

  async getHomeworkAttachment(
    userId: string,
    homeworkId: string,
    attachmentId: string,
  ) {
    const allowed = await this.homeworkStudents.findOne({
      where: { homeworkId, studentId: userId },
    });
    if (!allowed) {
      throw new AppError(403, "Homework is not assigned to you", "FORBIDDEN");
    }

    const attachment = await this.homeworkAttachments.findOne({
      where: { id: attachmentId, homeworkId },
    });
    if (!attachment) {
      throw new AppError(404, "Attachment not found", "ATTACHMENT_NOT_FOUND");
    }

    return {
      ...attachment,
      buffer: await getObjectBuffer(attachment.storageKey),
    };
  }

  async getHomeworkSubmission(userId: string, homeworkId: string) {
    const allowed = await this.homeworkStudents.findOne({
      where: { homeworkId, studentId: userId },
    });
    if (!allowed) {
      throw new AppError(403, "Homework is not assigned to you", "FORBIDDEN");
    }

    const homework = await this.homework.findOne({
      where: { id: homeworkId },
      relations: {
        attachments: true,
        subject: true,
        term: {
          academicYear: true,
          yearLevel: true,
        },
        createdBy: true,
      },
    });
    if (!homework) {
      throw new AppError(404, "Homework not found", "NOT_FOUND");
    }

    let submission = await this.homeworkSubmissions.findOne({
      where: { homeworkId, studentId: userId },
      relations: {
        files: true,
      },
    });

    if (!submission) {
      submission = await this.homeworkSubmissions.save(
        this.homeworkSubmissions.create({
          homeworkId,
          studentId: userId,
          status: "DRAFT",
          submittedAt: null,
        }),
      );
      submission.files = [];
    }

    const termLabel = homework.term
      ? homework.term.academicYear && homework.term.yearLevel
        ? `${homework.term.name} · ${homework.term.academicYear.year} · ${homework.term.yearLevel.name}`
        : homework.term.name
      : null;

    const teacherName = homework.createdBy
      ? homework.createdBy.preferredName ||
        homework.createdBy.fullName ||
        homework.createdBy.email
      : null;

    return {
      submission: {
        id: submission.id,
        homeworkId: submission.homeworkId,
        studentId: submission.studentId,
        status: submission.status,
        submittedAt: submission.submittedAt?.toISOString() ?? null,
        studentNotes: submission.studentNotes ?? null,
        marks: submission.marks != null ? Number(submission.marks) : null,
        maxMarks:
          submission.maxMarks != null
            ? Number(submission.maxMarks)
            : homework.maxMarks != null
              ? Number(homework.maxMarks)
              : 100,
        feedback: submission.feedback ?? null,
        isCompleted: Boolean(submission.isCompleted),
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
        homework: {
          id: homework.id,
          title: homework.title,
          description: homework.description,
          dueDate: homework.dueDate,
          subject: homework.subject?.name ?? null,
          term: termLabel,
          yearGroup: homework.yearGroup,
          teacherName,
          attachments: (homework.attachments ?? []).map((attachment) => ({
            id: attachment.id,
            originalName: attachment.originalName,
            mimeType: attachment.mimeType,
            byteSize: attachment.byteSize,
          })),
        },
      },
    };
  }

  async uploadHomeworkFiles(
    userId: string,
    homeworkId: string,
    files: UploadedHomeworkAnswerFile[],
  ) {
    if (files.length === 0) {
      throw new AppError(400, "No files uploaded", "NO_FILES");
    }

    const allowed = await this.homeworkStudents.findOne({
      where: { homeworkId, studentId: userId },
    });
    if (!allowed) {
      throw new AppError(403, "Homework is not assigned to you", "FORBIDDEN");
    }

    let submission = await this.homeworkSubmissions.findOne({
      where: { homeworkId, studentId: userId },
      relations: { files: true },
    });

    if (!submission) {
      submission = await this.homeworkSubmissions.save(
        this.homeworkSubmissions.create({
          homeworkId,
          studentId: userId,
          status: "DRAFT",
          submittedAt: null,
        }),
      );
      submission.files = [];
    }

    if (submission.status === "SUBMITTED") {
      throw new AppError(
        400,
        "Homework is already submitted and cannot be modified",
        "ALREADY_SUBMITTED",
      );
    }

    const existingCount = submission.files?.length ?? 0;
    const entitiesToSave: HomeworkSubmissionFile[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const storageKey = buildHomeworkSubmissionKey({
        homeworkId,
        studentId: userId,
        submissionId: submission.id,
        fileName: file.originalName,
      });

      await putObject({
        key: storageKey,
        body: file.buffer,
        contentType: file.mimeType,
      });

      entitiesToSave.push(
        this.homeworkSubmissionFiles.create({
          submissionId: submission.id,
          storageKey,
          originalName: file.originalName,
          mimeType: file.mimeType,
          byteSize: file.size,
          sortOrder: existingCount + i,
        }),
      );
    }

    await this.homeworkSubmissionFiles.save(entitiesToSave);

    return this.getHomeworkSubmission(userId, homeworkId);
  }

  async removeHomeworkFile(
    userId: string,
    homeworkId: string,
    fileId: string,
  ) {
    const submission = await this.homeworkSubmissions.findOne({
      where: { homeworkId, studentId: userId },
      relations: { files: true },
    });

    if (!submission) {
      throw new AppError(404, "Submission not found", "NOT_FOUND");
    }

    if (submission.status === "SUBMITTED") {
      throw new AppError(
        400,
        "Homework is already submitted and cannot be modified",
        "ALREADY_SUBMITTED",
      );
    }

    const file = await this.homeworkSubmissionFiles.findOne({
      where: { id: fileId, submissionId: submission.id },
    });
    if (!file) {
      throw new AppError(404, "File not found", "FILE_NOT_FOUND");
    }

    await deleteObject(file.storageKey);
    await this.homeworkSubmissionFiles.remove(file);

    return this.getHomeworkSubmission(userId, homeworkId);
  }

  async submitHomework(
    userId: string,
    homeworkId: string,
    input?: { studentNotes?: string | null },
  ) {
    const allowed = await this.homeworkStudents.findOne({
      where: { homeworkId, studentId: userId },
    });
    if (!allowed) {
      throw new AppError(403, "Homework is not assigned to you", "FORBIDDEN");
    }

    let submission = await this.homeworkSubmissions.findOne({
      where: { homeworkId, studentId: userId },
      relations: { files: true },
    });

    if (!submission) {
      submission = await this.homeworkSubmissions.save(
        this.homeworkSubmissions.create({
          homeworkId,
          studentId: userId,
          status: "DRAFT",
          submittedAt: null,
        }),
      );
      submission.files = [];
    }

    if ((submission.files ?? []).length === 0) {
      throw new AppError(
        400,
        "Please upload at least one answer file before submitting",
        "NO_FILES",
      );
    }

    if (input?.studentNotes !== undefined) {
      submission.studentNotes = input.studentNotes
        ? input.studentNotes.trim()
        : null;
    }

    submission.status = "SUBMITTED";
    submission.submittedAt = new Date();
    await this.homeworkSubmissions.save(submission);

    return this.getHomeworkSubmission(userId, homeworkId);
  }

  async getHomeworkSubmissionFile(
    userId: string,
    homeworkId: string,
    fileId: string,
  ) {
    const allowed = await this.homeworkStudents.findOne({
      where: { homeworkId, studentId: userId },
    });
    if (!allowed) {
      throw new AppError(403, "Homework is not assigned to you", "FORBIDDEN");
    }

    const submission = await this.homeworkSubmissions.findOne({
      where: { homeworkId, studentId: userId },
    });
    if (!submission) {
      throw new AppError(404, "Submission not found", "NOT_FOUND");
    }

    const file = await this.homeworkSubmissionFiles.findOne({
      where: { id: fileId, submissionId: submission.id },
    });
    if (!file) {
      throw new AppError(404, "File not found", "FILE_NOT_FOUND");
    }

    return {
      ...file,
      buffer: await getObjectBuffer(file.storageKey),
    };
  }

  private async listLessons(userId: string): Promise<StudentLessonDto[]> {
    const classes = await this.resolveStudentClasses(userId);
    const classLessons = await this.buildClassLessons(userId, classes);
    const context = await this.buildTimetableContext(userId, classes);
    const assessmentLessons = await this.buildAssessmentLessons(
      userId,
      context,
    );
    const fullDayExamWindows = assessmentLessons
      .filter((lesson) => lesson.scheduleType === "FULL_DAY")
      .map((lesson) => ({
        startAt: new Date(lesson.startAt).getTime(),
        endAt: new Date(lesson.endAt).getTime(),
      }));
    const visibleClassLessons = classLessons.filter((lesson) => {
      const startAt = new Date(lesson.startAt).getTime();
      const endAt = new Date(lesson.endAt).getTime();
      return !fullDayExamWindows.some(
        (exam) =>
          startAt < exam.endAt &&
          exam.startAt < endAt,
      );
    });

    return [...visibleClassLessons, ...assessmentLessons].sort(
      (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
    );
  }

  private async buildClassLessons(
    userId: string,
    classes: Class[],
  ): Promise<StudentLessonDto[]> {
    if (classes.length === 0) return [];

    const now = new Date();
    const timed = classes
      .map((cls) => {
        const times = parseClassTimes(cls.dayTime, cls.timeZone);
        return times ? { cls, ...times } : null;
      })
      .filter(
        (row): row is { cls: Class; startAt: Date; endAt: Date } =>
          Boolean(row),
      );

    const classIds = timed.map((row) => row.cls.id);
    const existingSessions = classIds.length
      ? await this.sessions.find({
          where: { classId: In(classIds), assessmentId: IsNull() },
        })
      : [];

    const sessionByKey = new Map(
      existingSessions.map((session) => [
        `${session.classId}|${new Date(session.startAt).getTime()}`,
        session,
      ]),
    );

    const toCreate = timed.filter(
      (row) => !sessionByKey.has(`${row.cls.id}|${row.startAt.getTime()}`),
    );
    if (toCreate.length > 0) {
      const created = await this.sessions.save(
        toCreate.map((row) =>
          this.sessions.create({
            classId: row.cls.id,
            assessmentId: null,
            startAt: row.startAt,
            endAt: row.endAt,
            room: row.cls.room,
            classroomId: row.cls.classroomId || null,
            gracePeriodMinutes: 25,
          }),
        ),
      );
      for (const session of created) {
        sessionByKey.set(
          `${session.classId}|${new Date(session.startAt).getTime()}`,
          session,
        );
      }
    }

    const sessionIds = [...sessionByKey.values()].map((session) => session.id);
    const attendanceRows = sessionIds.length
      ? await this.attendance.find({
          where: { studentId: userId, sessionId: In(sessionIds) },
        })
      : [];
    const attendanceBySession = new Map(
      attendanceRows.map((row) => [row.sessionId, row]),
    );

    const lessons: StudentLessonDto[] = [];
    for (const row of timed) {
      const session = sessionByKey.get(
        `${row.cls.id}|${row.startAt.getTime()}`,
      );
      if (!session) continue;
      const attendance = attendanceBySession.get(session.id);
      const online = isOnlineRoom(row.cls.room);
      const { status, minutesUntilStart, canCheckIn } = lessonStatus({
        startAt: row.startAt,
        endAt: row.endAt,
        attendanceStatus: attendance?.status ?? null,
        scannedAt: attendance?.scannedAt ?? null,
        online,
        now,
      });
      const termLabel = row.cls.term
        ? row.cls.term.academicYear && row.cls.term.yearLevel
          ? `${row.cls.term.name} · ${row.cls.term.academicYear.year} · ${row.cls.term.yearLevel.name}`
          : row.cls.term.name
        : row.cls.termName;

      const homeworkDue = new Date(row.endAt.getTime() + 2 * 24 * 60 * 60_000);
      lessons.push({
        sessionId: session.id,
        kind: "class",
        classId: row.cls.id,
        subject: row.cls.subject || row.cls.name,
        className: row.cls.subject || row.cls.name,
        room: row.cls.room || "Room",
        teacher: row.cls.teacher?.fullName ?? null,
        startAt: row.startAt.toISOString(),
        endAt: row.endAt.toISOString(),
        term: termLabel,
        termName: row.cls.term?.name ?? row.cls.termName ?? null,
        yearLevel: row.cls.term?.yearLevel?.name ?? null,
        weekLabel: weekLabelFor(row.startAt, row.cls.term?.startDate),
        topic: row.cls.lesson || "Lesson",
        homework: {
          title: `${row.cls.subject || "Class"} follow-up`,
          dueAt: homeworkDue.toISOString(),
        },
        status,
        minutesUntilStart,
        checkedInAt: attendance?.scannedAt
          ? attendance.scannedAt.toISOString()
          : null,
        isOnline: online,
        canCheckIn,
        timeZone: resolveIanaTimeZone(row.cls.timeZone),
        resources: buildResources(
          row.cls.subject || row.cls.name,
          row.startAt,
          row.endAt,
          now,
        ),
      });
    }

    return lessons;
  }

  private async buildTimetableContext(
    userId: string,
    classes: Class[],
  ): Promise<StudentTimetableContext> {
    const classIds = new Set(classes.map((cls) => cls.id));
    const subjectKeys = new Set<string>();
    const yearGroupKeys = new Set<string>();
    const academicYears = new Set<number>();

    for (const cls of classes) {
      const subject = (cls.subject || cls.name || "").trim().toLowerCase();
      if (subject) subjectKeys.add(subject);
      const yearLevel = yearGroupKey(cls.term?.yearLevel?.name);
      if (yearLevel) yearGroupKeys.add(yearLevel);
      const year = cls.term?.academicYear?.year;
      if (typeof year === "number") academicYears.add(year);
    }

    const student = await this.students.findOne({ where: { userId } });
    if (student) {
      if (student.yearLevel != null) {
        yearGroupKeys.add(`year ${student.yearLevel}`);
      }
      const enrollments = await this.enrollments.find({
        where: {
          studentId: student.id,
          status: In([
            EnrollmentStatus.ACTIVE,
            EnrollmentStatus.AWAITING_GUARDIAN,
          ]),
        },
        relations: {
          subjects: { subject: true },
          term: { academicYear: true, yearLevel: true },
        },
      });
      for (const enrollment of enrollments) {
        for (const row of enrollment.subjects ?? []) {
          const name = row.subject?.name?.trim().toLowerCase();
          if (name) subjectKeys.add(name);
        }
        const level = yearGroupKey(enrollment.term?.yearLevel?.name);
        if (level) yearGroupKeys.add(level);
        const year = enrollment.term?.academicYear?.year;
        if (typeof year === "number") academicYears.add(year);
      }
    }

    const linkedRows = await this.assessmentStudents.find({
      where: { studentId: userId },
      select: { assessmentId: true },
    });
    const linkedAssessmentIds = new Set(
      linkedRows.map((row) => row.assessmentId),
    );

    return {
      classIds,
      subjectKeys,
      yearGroupKeys,
      academicYears,
      linkedAssessmentIds,
    };
  }

  private assessmentVisibleToStudent(
    assessment: Assessment,
    context: StudentTimetableContext,
  ): boolean {
    if (context.linkedAssessmentIds.has(assessment.id)) return true;
    if (assessment.classId && context.classIds.has(assessment.classId)) {
      return true;
    }

    const subjectKey = assessment.subject.trim().toLowerCase();
    if (!subjectKey || !context.subjectKeys.has(subjectKey)) return false;

    const yearKey = yearGroupKey(assessment.yearGroup);
    if (yearKey && context.yearGroupKeys.size > 0) {
      const yearNum = yearGroupNumber(assessment.yearGroup);
      const matchesYear =
        context.yearGroupKeys.has(yearKey) ||
        (yearNum != null && context.yearGroupKeys.has(`year ${yearNum}`));
      if (!matchesYear) return false;
    }

    const assessmentYear = assessment.term?.academicYear?.year;
    if (
      typeof assessmentYear === "number" &&
      context.academicYears.size > 0 &&
      !context.academicYears.has(assessmentYear)
    ) {
      return false;
    }

    return true;
  }

  private async buildAssessmentLessons(
    userId: string,
    context: StudentTimetableContext,
  ): Promise<StudentLessonDto[]> {
    const linkedIds = [...context.linkedAssessmentIds];
    const classIds = [...context.classIds];
    const subjects = [...context.subjectKeys];
    if (linkedIds.length === 0 && classIds.length === 0 && subjects.length === 0) {
      return [];
    }

    const assessments = await this.assessments
      .createQueryBuilder("assessment")
      .leftJoinAndSelect("assessment.term", "term")
      .leftJoinAndSelect("term.academicYear", "academicYear")
      .leftJoinAndSelect("term.yearLevel", "yearLevel")
      .leftJoinAndSelect("assessment.teacher", "teacher")
      .leftJoinAndSelect("assessment.classroom", "classroom")
      .where("assessment.status NOT IN (:...excluded)", {
        excluded: [...EXCLUDED_ASSESSMENT_STATUSES],
      })
      .andWhere(
        new Brackets((where) => {
          if (linkedIds.length > 0) {
            where.orWhere("assessment.id IN (:...linkedIds)", { linkedIds });
          }
          if (classIds.length > 0) {
            where.orWhere("assessment.classId IN (:...classIds)", { classIds });
          }
          if (subjects.length > 0) {
            where.orWhere("LOWER(assessment.subject) IN (:...subjects)", {
              subjects,
            });
          }
        }),
      )
      .orderBy("assessment.assessmentDate", "ASC")
      .addOrderBy("assessment.startTime", "ASC")
      .getMany();
    const resourceRows =
      assessments.length > 0
        ? await this.assessmentResources.find({
            where: { assessmentId: In(assessments.map((row) => row.id)) },
            order: { createdAt: "ASC" },
          })
        : [];
    const resourcesByAssessment = new Map<string, AssessmentResource[]>();
    for (const resource of resourceRows) {
      const rows = resourcesByAssessment.get(resource.assessmentId) ?? [];
      rows.push(resource);
      resourcesByAssessment.set(resource.assessmentId, rows);
    }

    const now = new Date();
    const lessons: StudentLessonDto[] = [];

    for (const assessment of assessments) {
      if (!this.assessmentVisibleToStudent(assessment, context)) continue;

      const session =
        (await assessmentSessionSyncService.syncFromAssessment(
          assessment.id,
        )) ??
        (await assessmentSessionSyncService.findByAssessmentId(assessment.id));
      if (!session) continue;

      const window =
        assessmentScheduleWindow(
          assessment.assessmentDate,
          assessment.startTime,
          assessment.durationMinutes,
          assessment.scheduleType,
          assessment.timeZone,
        ) ?? {
          startAt: session.startAt,
          endAt: session.endAt,
        };

      const attendance = await this.attendance.findOne({
        where: { sessionId: session.id, studentId: userId },
      });
      const online = isOnlineRoom(session.room || assessment.room);
      const { status, minutesUntilStart, canCheckIn } = lessonStatus({
        startAt: window.startAt,
        endAt: window.endAt,
        attendanceStatus: attendance?.status ?? null,
        scannedAt: attendance?.scannedAt ?? null,
        online,
        now,
      });

      const termLabel = assessment.term
        ? assessment.term.academicYear && assessment.term.yearLevel
          ? `${assessment.term.name} · ${assessment.term.academicYear.year} · ${assessment.term.yearLevel.name}`
          : assessment.term.name
        : null;
      const room =
        session.room?.trim() ||
        assessment.room?.trim() ||
        assessment.classroom?.name?.trim() ||
        "—";

      lessons.push({
        sessionId: session.id,
        kind: "assessment",
        scheduleType: assessment.scheduleType ?? "SESSION",
        assessmentId: assessment.id,
        classId: session.classId ?? assessment.classId ?? "",
        subject: assessment.subject,
        className: assessment.name,
        room,
        teacher: assessment.teacher?.fullName ?? null,
        startAt: window.startAt.toISOString(),
        endAt: window.endAt.toISOString(),
        term: termLabel,
        termName: assessment.term?.name ?? null,
        yearLevel:
          assessment.yearGroup || assessment.term?.yearLevel?.name || null,
        weekLabel: weekLabelFor(window.startAt, assessment.term?.startDate),
        topic: assessment.name,
        homework: null,
        status,
        minutesUntilStart,
        checkedInAt: attendance?.scannedAt
          ? attendance.scannedAt.toISOString()
          : null,
        isOnline: online,
        canCheckIn,
        timeZone: resolveAssessmentTimeZone(assessment.timeZone),
        resources: [
          ...resourcesByAssessment.get(assessment.id)?.map((resource) => ({
            id: resource.id,
            title: resource.originalName,
            kind: "DOCUMENT" as const,
            releasedAt: resource.createdAt.toISOString(),
            released: true,
            downloadable: true,
          })) ?? [],
        ],
      });
    }

    return lessons;
  }

  private async resolveStudentClasses(userId: string): Promise<Class[]> {
    const student = await this.students.findOne({ where: { userId } });
    const linked = await this.classStudents.find({
      where: { studentId: userId },
      relations: { class: { term: { yearLevel: true } } },
    });
    const classIds = new Set<string>();
    for (const row of linked) {
      if (
        student &&
        !yearLevelsCompatible(
          student.yearLevel,
          termYearLevelNumber(row.class?.term),
        )
      ) {
        await this.classStudents.remove(row);
        continue;
      }
      classIds.add(row.classId);
    }

    if (student) {
      const enrollments = await this.enrollments.find({
        where: {
          studentId: student.id,
          status: In([EnrollmentStatus.ACTIVE]),
        },
        relations: {
          subjects: { subject: true },
          term: true,
        },
      });

      const subjectNames = new Set(
        enrollments.flatMap((enrollment) =>
          (enrollment.subjects ?? [])
            .map((row) => row.subject?.name?.trim().toLowerCase())
            .filter(Boolean),
        ),
      );
      const termIds = new Set(
        enrollments.map((enrollment) => enrollment.termId).filter(Boolean),
      );
      const studentYear = student.yearLevel;

      if (subjectNames.size > 0) {
        const catalogue = await this.classes.find({
          relations: {
            teacher: true,
            term: { academicYear: true, yearLevel: true },
          },
        });
        for (const cls of catalogue) {
          const subject = (cls.subject ?? "").trim().toLowerCase();
          if (!subjectNames.has(subject)) continue;
          if (termIds.size > 0 && cls.term?.id && !termIds.has(cls.term.id)) {
            continue;
          }
          if (
            !yearLevelsCompatible(studentYear, termYearLevelNumber(cls.term))
          ) {
            continue;
          }
          classIds.add(cls.id);
          await this.ensureClassStudent(cls.id, userId);
        }
      }
    }

    if (classIds.size === 0) return [];

    return this.classes.find({
      where: { id: In([...classIds]) },
      relations: {
        teacher: true,
        term: { academicYear: true, yearLevel: true },
      },
      order: { createdAt: "ASC" },
    });
  }

  private async ensureClassStudent(classId: string, studentId: string) {
    const existing = await this.classStudents.findOne({
      where: { classId, studentId },
    });
    if (existing) return;
    await this.classStudents.save(
      this.classStudents.create({ classId, studentId }),
    );

    // Create PENDING attendance records for existing sessions of this class
    const sessions = await this.sessions.find({ where: { classId } });
    for (const session of sessions) {
      const existingRecord = await this.attendance.findOne({
        where: { sessionId: session.id, studentId },
      });
      if (!existingRecord) {
        await this.attendance.save(
          this.attendance.create({
            sessionId: session.id,
            studentId,
            status: AttendanceStatus.PENDING,
            scannedAt: null,
          }),
        );
      }
    }
  }

  private toStudentHomeworkDto(
    homework: Homework,
    studentId?: string,
  ): StudentHomeworkDto {
    const term = homework.term
      ? homework.term.academicYear && homework.term.yearLevel
        ? `${homework.term.name} · ${homework.term.academicYear.year} · ${homework.term.yearLevel.name}`
        : homework.term.name
      : null;

    const studentSubmission = studentId
      ? homework.submissions?.find((s) => s.studentId === studentId)
      : homework.submissions?.[0];

    const submissionSummary: StudentHomeworkSubmissionSummaryDto | null =
      studentSubmission
        ? {
            id: studentSubmission.id,
            status: studentSubmission.status,
            submittedAt: studentSubmission.submittedAt?.toISOString() ?? null,
            filesCount: (studentSubmission.files ?? []).length,
          }
        : null;

    return {
      id: homework.id,
      title: homework.title,
      description: homework.description,
      dueDate: homework.dueDate,
      subject: homework.subject?.name ?? null,
      term,
      yearGroup: homework.yearGroup,
      attachments: (homework.attachments ?? []).map((attachment) => ({
        id: attachment.id,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        byteSize: attachment.byteSize,
      })),
      submission: submissionSummary,
    };
  }
}

export const studentClassesService = new StudentClassesService();
