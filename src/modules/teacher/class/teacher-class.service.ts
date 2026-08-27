import { AppDataSource } from "../../../config/data-source.js";
import { DEFAULT_CLASS_TIMEZONE } from "../../../common/utils/timezone.js";
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

export class TeacherClassService {
  private readonly repo = teacherClassRepository;
  private readonly sessions = AppDataSource.getRepository(Session);

  async getTeacherDashboardData(teacherId: string) {
    await assessmentSessionSyncService.ensureForTeacher(teacherId);

    const classes = await this.repo.findClassesByTeacherId(teacherId);
    const classIds = classes.map((classItem) => classItem.id);

    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const until = new Date();
    until.setHours(23, 59, 59, 999);
    const tomorrow = new Date(since);
    tomorrow.setDate(tomorrow.getDate() + 1);

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

    const activeSessions = [...classSessions, ...assessmentSessions]
      .filter((session, index, all) => {
        const first = all.findIndex((row) => row.id === session.id);
        return first === index;
      })
      .sort(
        (a, b) =>
          new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
      );

    const weekSessions = [...classWeekSessions, ...assessmentWeekSessions]
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
}

export const teacherClassService = new TeacherClassService();
