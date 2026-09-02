import { AppDataSource } from "../../../config/data-source.js";
import {
  DEFAULT_CLASS_TIMEZONE,
  dayRangeInTimeZone,
} from "../../../common/utils/timezone.js";
import { buildScheduleSlotKey } from "../../../common/utils/schedule-slot.js";
import { Session } from "../../../entities/index.js";
import { assessmentSessionSyncService } from "../../admin/assessments/assessment-session-sync.service.js";
import { teacherClassRepository } from "./teacher-class.repository.js";

function mapSessionDto(session: Session) {
  const isAssessment = Boolean(session.assessmentId);
  const assessment = session.assessment;
  const cls = session.class;

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
    room: session.room ?? cls?.room ?? assessment?.room ?? null,
    startAt: session.startAt,
    endAt: session.endAt,
    gracePeriodMinutes: session.gracePeriodMinutes,
    timeZone: cls?.timeZone ?? DEFAULT_CLASS_TIMEZONE,
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
      activeSessions: activeSessions.map(mapSessionDto),
      weekSessions: weekSessions.map(mapSessionDto),
    };
  }

  private async findAssessmentSessions(
    teacherId: string,
    since?: Date,
    until?: Date,
  ): Promise<Session[]> {
    const qb = this.sessions
      .createQueryBuilder("session")
      .innerJoinAndSelect("session.assessment", "assessment")
      .leftJoinAndSelect("session.class", "class")
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
