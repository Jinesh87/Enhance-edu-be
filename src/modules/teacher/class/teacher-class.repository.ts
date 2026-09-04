import { In, IsNull } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import { parseDayTime } from "../../../common/utils/timezone.js";
import { ClassStudent, Class, Session } from "../../../entities/index.js";

export class TeacherClassRepository {
  private readonly classes = AppDataSource.getRepository(Class);
  private readonly sessions = AppDataSource.getRepository(Session);

  async findClassesByTeacherId(teacherId: string): Promise<Class[]> {
    return this.classes.find({
      where: { teacher: { id: teacherId } },
    });
  }

  async ensureSessionsExistForClassIds(classIds: string[]): Promise<void> {
    if (classIds.length === 0) return;

    const existingSessions = await this.sessions.find({
      where: { classId: In(classIds), assessmentId: IsNull() },
      select: { classId: true },
    });
    const classesWithSessions = new Set(
      existingSessions.map((s) => s.classId).filter(Boolean),
    );

    const missingClassIds = classIds.filter(
      (id) => !classesWithSessions.has(id),
    );
    if (missingClassIds.length === 0) return;

    const missingClasses = await this.classes.find({
      where: { id: In(missingClassIds) },
    });

    const sessionsToCreate: Session[] = [];
    for (const c of missingClasses) {
      if (!c.dayTime) continue;
      try {
        const times = parseDayTime(c.dayTime, c.timeZone);
        if (!times) continue;
        sessionsToCreate.push(
          this.sessions.create({
            classId: c.id,
            assessmentId: null,
            startAt: times.startAt,
            endAt: times.endAt,
            room: c.room || null,
            classroomId: c.classroomId || null,
            gracePeriodMinutes: 25,
          }),
        );
      } catch (err) {
        console.error(
          "Failed to parse dayTime during self-healing in repository:",
          c.dayTime,
          err,
        );
      }
    }

    if (sessionsToCreate.length > 0) {
      await this.sessions.save(sessionsToCreate);
    }
  }

  async findSessionsByClassIds(
    classIds: string[],
    since?: Date,
    until?: Date,
  ): Promise<Session[]> {
    await this.ensureSessionsExistForClassIds(classIds);

    const qb = this.sessions
      .createQueryBuilder("session")
      .leftJoinAndSelect("session.class", "class")
      .leftJoinAndSelect("class.term", "term")
      .leftJoinAndSelect("class.teacher", "teacher")
      .where("session.classId IN (:...classIds)", { classIds })
      .andWhere("session.assessmentId IS NULL");

    if (since) {
      qb.andWhere("session.endAt >= :since", { since });
    }
    if (until) {
      qb.andWhere("session.startAt <= :until", { until });
    }

    return qb.orderBy("session.startAt", "ASC").getMany();
  }

  async countEnrollmentsByClassIds(
    classIds: string[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (classIds.length === 0) return counts;

    const rows = await AppDataSource.getRepository(ClassStudent)
      .createQueryBuilder("enrol")
      .select("enrol.classId", "classId")
      .addSelect("COUNT(*)", "count")
      .where("enrol.classId IN (:...classIds)", { classIds })
      .groupBy("enrol.classId")
      .getRawMany<{ classId: string; count: string }>();

    for (const row of rows) {
      counts.set(row.classId, Number(row.count) || 0);
    }
    return counts;
  }

  async hasTeacherSessionsAfter(
    teacherId: string,
    after: Date,
    subject?: string,
  ): Promise<boolean> {
    const classQb = this.sessions
      .createQueryBuilder("session")
      .innerJoin("session.class", "class")
      .where("session.assessmentId IS NULL")
      .andWhere("session.startAt > :after", { after })
      .andWhere(
        "(session.teacherId = :teacherId OR (session.teacherId IS NULL AND class.teacherId = :teacherId))",
        { teacherId },
      );

    if (subject?.trim()) {
      classQb.andWhere("LOWER(TRIM(class.subject)) = LOWER(:subject)", {
        subject: subject.trim(),
      });
    }

    const classMatch = await classQb.getCount();
    if (classMatch > 0) return true;

    const assessmentQb = this.sessions
      .createQueryBuilder("session")
      .innerJoin("session.assessment", "assessment")
      .where("session.assessmentId IS NOT NULL")
      .andWhere("assessment.teacherId = :teacherId", { teacherId })
      .andWhere("session.startAt > :after", { after });

    if (subject?.trim()) {
      assessmentQb.andWhere("LOWER(TRIM(assessment.subject)) = LOWER(:subject)", {
        subject: subject.trim(),
      });
    }

    return (await assessmentQb.getCount()) > 0;
  }
}

export const teacherClassRepository = new TeacherClassRepository();
