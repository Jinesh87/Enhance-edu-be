import { In, IsNull } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import { parseDayTime } from "../../../common/utils/timezone.js";
import { Class, Session } from "../../../entities/index.js";

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
}

export const teacherClassRepository = new TeacherClassRepository();
