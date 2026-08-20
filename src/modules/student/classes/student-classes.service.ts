import { In } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import { EnrollmentStatus } from "../../../common/constants/enrollment.js";
import { AppError } from "../../../common/errors/AppError.js";
import { parseDayTime, resolveIanaTimeZone } from "../../../common/utils/timezone.js";
import {
  AttendanceRecord,
  AttendanceStatus,
  Class,
  ClassStudent,
  Enrollment,
  Session,
  Student,
} from "../../../entities/index.js";

export type StudentLessonStatus =
  | "ATTENDED"
  | "LIVE"
  | "SOON"
  | "UPCOMING"
  | "ONLINE"
  | "MISSED";

export type StudentLessonDto = {
  sessionId: string;
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
    kind: "SLIDES" | "WORKSHEET" | "RECORDING" | "PAPER";
    releasedAt: string;
    released: boolean;
  }[];
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

function isOnlineRoom(room: string | null | undefined) {
  const value = (room ?? "").toLowerCase();
  return value.includes("zoom") || value.includes("online");
}

function lessonStatus(input: {
  startAt: Date;
  endAt: Date;
  attended: boolean;
  online: boolean;
  now: Date;
}): { status: StudentLessonStatus; minutesUntilStart: number | null; canCheckIn: boolean } {
  const minutesUntilStart = Math.round(
    (input.startAt.getTime() - input.now.getTime()) / 60_000,
  );
  const inWindow =
    input.now.getTime() >= input.startAt.getTime() - 15 * 60_000 &&
    input.now.getTime() <= input.endAt.getTime();

  if (input.attended) {
    return { status: "ATTENDED", minutesUntilStart, canCheckIn: false };
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
      (lesson) => new Date(lesson.endAt).getTime() < now.getTime(),
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

  private async listLessons(userId: string): Promise<StudentLessonDto[]> {
    const classes = await this.resolveStudentClasses(userId);
    if (classes.length === 0) return [];

    const now = new Date();
    const timed = classes
      .map((cls) => {
        const times = parseClassTimes(cls.dayTime, cls.timeZone);
        return times ? { cls, ...times } : null;
      })
      .filter((row): row is { cls: Class; startAt: Date; endAt: Date } => Boolean(row));

    const classIds = timed.map((row) => row.cls.id);
    const existingSessions = classIds.length
      ? await this.sessions.find({ where: { classId: In(classIds) } })
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
            startAt: row.startAt,
            endAt: row.endAt,
            room: row.cls.room,
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
      const attended =
        attendance?.status === AttendanceStatus.PRESENT ||
        attendance?.status === AttendanceStatus.LATE;
      const online = isOnlineRoom(row.cls.room);
      const { status, minutesUntilStart, canCheckIn } = lessonStatus({
        startAt: row.startAt,
        endAt: row.endAt,
        attended: Boolean(attended),
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

    return lessons.sort(
      (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
    );
  }

  private async resolveStudentClasses(userId: string): Promise<Class[]> {
    const linked = await this.classStudents.find({
      where: { studentId: userId },
    });
    const classIds = new Set(linked.map((row) => row.classId));

    const student = await this.students.findOne({ where: { userId } });
    if (student) {
      const enrollments = await this.enrollments.find({
        where: {
          studentId: student.id,
          status: In([EnrollmentStatus.ACTIVE, EnrollmentStatus.PENDING]),
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
}

export const studentClassesService = new StudentClassesService();
