import { In } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import {
  DEFAULT_CLASS_TIMEZONE,
  dayRangeInTimeZone,
} from "../../../common/utils/timezone.js";
import { buildScheduleSlotKey } from "../../../common/utils/schedule-slot.js";
import {
  addCalendarDays,
  buildTeacherUpcomingRanges,
  weekRangeFromMondayStart,
} from "../../../common/utils/teacher-week-range.js";
import { AppError } from "../../../common/errors/AppError.js";
import {
  AssessmentStudent,
  AttendanceRecord,
  AttendanceStatus,
  Session,
} from "../../../entities/index.js";
import { assessmentSessionSyncService } from "../../admin/assessments/assessment-session-sync.service.js";
import { AttendanceRepository } from "../../shared/attendance/attendance.repository.js";
import { sharedAttendanceService } from "../../shared/attendance/shared-attendance.service.js";
import { teacherClassRepository } from "./teacher-class.repository.js";

function mapSessionDto(
  session: Session,
  extras?: {
    enrolledCount?: number;
    attendedCount?: number;
    absentCount?: number;
  },
) {
  const isAssessment = Boolean(session.assessmentId);
  const assessment = session.assessment;
  const cls = session.class;
  const nowMs = Date.now();
  const startMs = session.startAt.getTime();
  const endMs = session.endAt.getTime();
  let status: "upcoming" | "live" | "ended" = "upcoming";
  if (nowMs > endMs) status = "ended";
  else if (nowMs >= startMs) status = "live";

  return {
    id: session.id,
    kind: isAssessment ? ("assessment" as const) : ("class" as const),
    scheduleType: isAssessment
      ? assessment?.scheduleType ?? "SESSION"
      : undefined,
    assessmentId: session.assessmentId ?? null,
    classId: session.classId ?? "assessment",
    className: isAssessment
      ? assessment?.name || "Assessment"
      : cls?.name || "Class",
    classCode: isAssessment ? "EXAM" : cls?.code || "",
    subject: isAssessment ? assessment?.subject || "" : cls?.subject || "",
    lesson: isAssessment ? null : cls?.lesson ?? null,
    yearGroup: isAssessment
      ? assessment?.yearGroup ?? null
      : cls?.term?.yearLevel?.name ?? null,
    termName: isAssessment
      ? assessment?.term?.name ?? null
      : cls?.term?.name ?? null,
    room: session.room ?? cls?.room ?? assessment?.room ?? null,
    startAt: session.startAt,
    endAt: session.endAt,
    gracePeriodMinutes: session.gracePeriodMinutes,
    timeZone: cls?.timeZone ?? DEFAULT_CLASS_TIMEZONE,
    status,
    enrolledCount: extras?.enrolledCount,
    attendedCount: extras?.attendedCount,
    absentCount: extras?.absentCount,
  };
}

function dedupeSessionsByScheduleSlot(sessions: Session[]): Session[] {
  const seen = new Map<string, Session>();
  for (const session of sessions) {
    const termId = session.class?.term?.id ?? "";
    const slotKey =
      (session.class ? buildScheduleSlotKey(session.class) : null) ??
      `${session.classId}|${session.startAt.getTime()}`;
    const key = `${termId}|${slotKey}`;
    if (!seen.has(key)) {
      seen.set(key, session);
    }
  }
  return Array.from(seen.values());
}

export class TeacherClassService {
  private readonly repo = teacherClassRepository;
  private readonly sessions = AppDataSource.getRepository(Session);
  private readonly attendanceRepo = new AttendanceRepository();

  async getTeacherSubjects(teacherId: string) {
    await assessmentSessionSyncService.ensureForTeacher(teacherId);
    const classes = await this.repo.findClassesByTeacherId(teacherId);
    const subjects = new Set<string>();
    for (const cls of classes) {
      if (cls.subject?.trim()) subjects.add(cls.subject.trim());
    }

    const assessmentRows = await this.sessions
      .createQueryBuilder("session")
      .innerJoin("session.assessment", "assessment")
      .select("DISTINCT assessment.subject", "subject")
      .where("assessment.teacherId = :teacherId", { teacherId })
      .andWhere("assessment.status NOT IN (:...excluded)", {
        excluded: ["ARCHIVED", "CANCELLED"],
      })
      .getRawMany<{ subject: string | null }>();

    for (const row of assessmentRows) {
      if (row.subject?.trim()) subjects.add(row.subject.trim());
    }

    return {
      subjects: Array.from(subjects).sort((a, b) => a.localeCompare(b)),
    };
  }

  async listUpcomingSessions(
    teacherId: string,
    options: {
      subject?: string;
      range: "initial" | "week";
      weekStart?: string;
    },
  ) {
    await assessmentSessionSyncService.ensureForTeacher(teacherId);
    const subject = options.subject?.trim() || undefined;
    const ranges = buildTeacherUpcomingRanges();

    if (options.range === "week") {
      if (!options.weekStart) {
        throw new AppError(400, "weekStart is required", "WEEK_START_REQUIRED");
      }
      const { start, end, weekEndKey } = weekRangeFromMondayStart(
        options.weekStart,
      );
      const sessions = await this.fetchTeacherSessionsInRange(
        teacherId,
        start,
        end,
        subject,
      );
      const hasMoreWeeks = await this.repo.hasTeacherSessionsAfter(
        teacherId,
        end,
        subject,
      );
      return {
        range: "week" as const,
        weekStart: options.weekStart,
        weekEnd: weekEndKey,
        sessions: await this.mapSessionsWithEnrollment(sessions),
        hasMoreWeeks,
        nextWeekStart: hasMoreWeeks
          ? addCalendarDays(weekEndKey, 1)
          : null,
      };
    }

    const [todaySessions, thisWeekSessions, nextWeekSessions] =
      await Promise.all([
        this.fetchTeacherSessionsInRange(
          teacherId,
          ranges.todayStart,
          ranges.todayEnd,
          subject,
        ),
        this.fetchTeacherSessionsInRange(
          teacherId,
          ranges.thisWeekStart,
          ranges.thisWeekEnd,
          subject,
        ),
        this.fetchTeacherSessionsInRange(
          teacherId,
          ranges.nextWeekStart,
          ranges.nextWeekEnd,
          subject,
        ),
      ]);

    const hasMoreWeeks = await this.repo.hasTeacherSessionsAfter(
      teacherId,
      ranges.nextWeekEnd,
      subject,
    );

    return {
      range: "initial" as const,
      today: await this.mapSessionsWithEnrollment(todaySessions),
      thisWeek: await this.mapSessionsWithEnrollment(thisWeekSessions),
      nextWeek: await this.mapSessionsWithEnrollment(nextWeekSessions),
      hasMoreWeeks,
      nextWeekStart: hasMoreWeeks ? ranges.nextExtraWeekStart : null,
    };
  }

  async listPastSessions(
    teacherId: string,
    options: { subject?: string; page?: number; limit?: number },
  ) {
    await assessmentSessionSyncService.ensureForTeacher(teacherId);
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(50, Math.max(1, options.limit ?? 15));
    const subject = options.subject?.trim() || undefined;
    const now = new Date();

    // Effective teacher only: do not inherit every past session for classes
    // this teacher currently owns (those stay with the frozen session.teacherId).
    const qb = this.sessions
      .createQueryBuilder("session")
      .leftJoinAndSelect("session.class", "class")
      .leftJoinAndSelect("class.term", "term")
      .leftJoinAndSelect("term.yearLevel", "yearLevel")
      .leftJoinAndSelect("session.assessment", "assessment")
      .where("session.endAt < :now", { now })
      .andWhere(
        "(session.teacherId = :teacherId OR (session.teacherId IS NULL AND class.teacherId = :teacherId) OR assessment.teacherId = :teacherId)",
        { teacherId },
      );

    if (subject) {
      qb.andWhere(
        "(LOWER(TRIM(class.subject)) = LOWER(:subject) OR LOWER(TRIM(assessment.subject)) = LOWER(:subject))",
        { subject },
      );
    }

    const total = await qb.getCount();
    const rows = await qb
      .orderBy("session.startAt", "DESC")
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    const deduped = dedupeSessionsByScheduleSlot(rows);
    const sessionIds = deduped.map((row) => row.id);
    const attendanceSummary =
      await this.summarizeAttendanceForSessions(sessionIds);
    const enrollmentCounts = await this.repo.countEnrollmentsByClassIds(
      deduped
        .map((row) => row.classId)
        .filter((id): id is string => Boolean(id)),
    );

    const sessions = deduped.map((session) => {
      const summary = attendanceSummary.get(session.id);
      const enrolledCount = session.classId
        ? enrollmentCounts.get(session.classId)
        : session.assessment?.students?.length;
      return mapSessionDto(session, {
        enrolledCount,
        attendedCount: summary?.attended,
        absentCount: summary?.absent,
      });
    });

    return {
      sessions,
      total,
      page,
      limit,
      hasMore: page * limit < total,
    };
  }

  async getSessionDetail(teacherId: string, sessionId: string) {
    const session = await this.attendanceRepo.findSessionWithClassById(sessionId);
    if (!session) {
      throw new AppError(404, "Session not found", "SESSION_NOT_FOUND");
    }
    if (!this.teacherOwnsSession(teacherId, session)) {
      throw new AppError(403, "Access denied", "SESSION_ACCESS_DENIED");
    }

    const rollData = await sharedAttendanceService.getLiveRollData(sessionId);
    const attended: typeof rollData.roll = [];
    const absent: typeof rollData.roll = [];
    const excused: typeof rollData.roll = [];
    const exceptions: typeof rollData.roll = [];

    for (const row of rollData.roll) {
      const normalized = row.status.toLowerCase();
      if (
        normalized === "present" ||
        normalized === "late" ||
        normalized === "syncing..."
      ) {
        attended.push(row);
      } else if (normalized === "excused") {
        excused.push(row);
      } else if (normalized === "exception" || normalized.includes("exception")) {
        exceptions.push(row);
      } else {
        absent.push(row);
      }
    }

    const attendanceRecords =
      await this.attendanceRepo.findAttendanceRecordsBySessionId(sessionId);
    const notes = attendanceRecords
      .filter((record) => record.manualReason?.trim())
      .map((record) => {
        const student = rollData.roll.find((row) => row.id === record.studentId);
        return {
          studentId: record.studentId,
          studentName: student?.fullName ?? "Student",
          note: record.manualReason!.trim(),
          status: record.status,
          markedManually: record.markedManually,
        };
      });

    const enrolledCount = rollData.roll.length;
    const sessionDto = mapSessionDto(session, {
      enrolledCount,
      attendedCount: attended.length,
      absentCount: absent.length,
    });

    return {
      session: sessionDto,
      attended,
      absent,
      excused,
      exceptions,
      notes,
      summary: {
        enrolled: enrolledCount,
        attended: attended.length,
        absent: absent.length,
        excused: excused.length,
        exceptions: exceptions.length,
      },
    };
  }

  private teacherOwnsSession(teacherId: string, session: Session): boolean {
    if (session.assessment?.teacherId === teacherId) return true;
    const effectiveTeacherId =
      session.teacherId ?? session.class?.teacher?.id ?? null;
    return effectiveTeacherId === teacherId;
  }

  private async mapSessionsWithEnrollment(sessions: Session[]) {
    const enrollmentCounts = await this.repo.countEnrollmentsByClassIds(
      sessions
        .map((session) => session.classId)
        .filter((id): id is string => Boolean(id)),
    );
    return Promise.all(
      sessions.map(async (session) =>
        mapSessionDto(session, {
          enrolledCount: session.classId
            ? enrollmentCounts.get(session.classId)
            : session.assessmentId
              ? await this.countAssessmentStudents(session.assessmentId)
              : undefined,
        }),
      ),
    );
  }

  private async countAssessmentStudents(assessmentId: string): Promise<number> {
    return AppDataSource.getRepository(AssessmentStudent).count({
      where: { assessmentId },
    });
  }

  private async summarizeAttendanceForSessions(sessionIds: string[]) {
    const summary = new Map<string, { attended: number; absent: number }>();
    if (sessionIds.length === 0) return summary;

    const records = await AppDataSource.getRepository(AttendanceRecord).find({
      where: { sessionId: In(sessionIds) },
      select: { sessionId: true, status: true },
    });

    for (const record of records) {
      const current = summary.get(record.sessionId) ?? {
        attended: 0,
        absent: 0,
      };
      if (
        record.status === AttendanceStatus.PRESENT ||
        record.status === AttendanceStatus.LATE
      ) {
        current.attended += 1;
      } else if (
        record.status === AttendanceStatus.ABSENT ||
        record.status === AttendanceStatus.PENDING
      ) {
        current.absent += 1;
      }
      summary.set(record.sessionId, current);
    }
    return summary;
  }

  private async fetchTeacherSessionsInRange(
    teacherId: string,
    since: Date,
    until: Date,
    subject?: string,
  ): Promise<Session[]> {
    const classes = await this.repo.findClassesByTeacherId(teacherId);
    const classIds = classes.map((cls) => cls.id);

    const classSessions =
      classIds.length > 0
        ? await this.repo.findSessionsByClassIds(classIds, since, until)
        : [];

    const filteredClassSessions = classSessions.filter((session) => {
      const sessionTeacherId =
        session.teacherId ?? session.class?.teacher?.id ?? null;
      if (sessionTeacherId && sessionTeacherId !== teacherId) return false;
      if (!subject) return true;
      return (
        session.class?.subject?.trim().toLowerCase() === subject.toLowerCase()
      );
    });

    const assessmentSessions = await this.findAssessmentSessions(
      teacherId,
      since,
      until,
      subject,
    );

    const fullDayAssessmentSessions =
      await this.findFullDayAssessmentSessions(since, until);

    const visibleClassSessions = dedupeSessionsByScheduleSlot(
      filteredClassSessions.filter(
        (session) =>
          !this.isSupersededByFullDayExam(session, fullDayAssessmentSessions),
      ),
    );

    const merged = [...visibleClassSessions, ...assessmentSessions]
      .filter((session, index, all) => {
        const first = all.findIndex((row) => row.id === session.id);
        return first === index;
      })
      .sort(
        (a, b) => a.startAt.getTime() - b.startAt.getTime(),
      );

    return merged;
  }

  async getTeacherDashboardData(teacherId: string) {
    await assessmentSessionSyncService.ensureForTeacher(teacherId);

    const classes = await this.repo.findClassesByTeacherId(teacherId);
    const classIds = classes.map((classItem) => classItem.id);

    const todayRange = dayRangeInTimeZone(
      new Date(),
      DEFAULT_CLASS_TIMEZONE,
    );
    const since = todayRange.start;
    const until = new Date(todayRange.end.getTime() - 1);
    const tomorrow = todayRange.end;

    const classSessions =
      classIds.length > 0
        ? await this.repo.findSessionsByClassIds(classIds, since, until)
        : [];
    const classWeekSessions =
      classIds.length > 0
        ? await this.repo.findSessionsByClassIds(classIds, tomorrow)
        : [];

    const assessmentSessions = await this.findAssessmentSessions(
      teacherId,
      since,
      until,
    );
    const assessmentWeekSessions = await this.findAssessmentSessions(
      teacherId,
      tomorrow,
    );
    const fullDayAssessmentSessions =
      await this.findFullDayAssessmentSessions(since, until);
    const fullDayWeekAssessmentSessions =
      await this.findFullDayAssessmentSessions(tomorrow);
    const visibleClassSessions = dedupeSessionsByScheduleSlot(
      classSessions.filter(
        (session) =>
          !this.isSupersededByFullDayExam(session, fullDayAssessmentSessions),
      ),
    );
    const visibleClassWeekSessions = dedupeSessionsByScheduleSlot(
      classWeekSessions.filter(
        (session) =>
          !this.isSupersededByFullDayExam(
            session,
            fullDayWeekAssessmentSessions,
          ),
      ),
    );

    const activeSessions = [...visibleClassSessions, ...assessmentSessions]
      .filter((session, index, all) => {
        const first = all.findIndex((row) => row.id === session.id);
        return first === index;
      })
      .sort(
        (a, b) =>
          new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
      );

    const weekSessions = [...visibleClassWeekSessions, ...assessmentWeekSessions]
      .filter((session, index, all) => {
        const first = all.findIndex((row) => row.id === session.id);
        return first === index && !activeSessions.some((a) => a.id === session.id);
      })
      .sort(
        (a, b) =>
          new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
      );

    return {
      classes: classes.map((classItem) => ({
        id: classItem.id,
        name: classItem.name,
        code: classItem.code,
        room: classItem.room,
      })),
      activeSessions: activeSessions.map((session) => mapSessionDto(session)),
      weekSessions: weekSessions.map((session) => mapSessionDto(session)),
    };
  }

  private async findAssessmentSessions(
    teacherId: string,
    since?: Date,
    until?: Date,
    subject?: string,
  ): Promise<Session[]> {
    const qb = this.sessions
      .createQueryBuilder("session")
      .innerJoinAndSelect("session.assessment", "assessment")
      .leftJoinAndSelect("session.class", "class")
      .leftJoinAndSelect("assessment.term", "term")
      .leftJoinAndSelect("term.yearLevel", "yearLevel")
      .where("assessment.teacherId = :teacherId", { teacherId })
      .andWhere("assessment.status NOT IN (:...excluded)", {
        excluded: ["ARCHIVED", "CANCELLED"],
      })
      .andWhere("session.assessmentId IS NOT NULL");

    if (since) {
      qb.andWhere("session.endAt >= :since", { since });
    }
    if (until) {
      qb.andWhere("session.startAt <= :until", { until });
    }
    if (subject) {
      qb.andWhere("LOWER(TRIM(assessment.subject)) = LOWER(:subject)", {
        subject,
      });
    }

    return qb.orderBy("session.startAt", "ASC").getMany();
  }

  private async findFullDayAssessmentSessions(
    since?: Date,
    until?: Date,
  ): Promise<Session[]> {
    const qb = this.sessions
      .createQueryBuilder("session")
      .innerJoinAndSelect("session.assessment", "assessment")
      .where("assessment.scheduleType = :scheduleType", {
        scheduleType: "FULL_DAY",
      })
      .andWhere("assessment.status NOT IN (:...excluded)", {
        excluded: ["ARCHIVED", "CANCELLED"],
      })
      .andWhere("session.assessmentId IS NOT NULL");

    if (since) {
      qb.andWhere("session.endAt >= :since", { since });
    }
    if (until) {
      qb.andWhere("session.startAt <= :until", { until });
    }

    return qb.getMany();
  }

  private isSupersededByFullDayExam(
    session: Session,
    fullDayAssessmentSessions: Session[],
  ): boolean {
    return fullDayAssessmentSessions.some(
      (exam) =>
        session.startAt.getTime() < exam.endAt.getTime() &&
        exam.startAt.getTime() < session.endAt.getTime(),
    );
  }
}

export const teacherClassService = new TeacherClassService();
