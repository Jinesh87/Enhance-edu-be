import { teacherClassRepository } from "./teacher-class.repository.js";

export class TeacherClassService {
  private readonly repo = teacherClassRepository;

  async getTeacherDashboardData(teacherId: string) {
    const classes = await this.repo.findClassesByTeacherId(teacherId);

    const classIds = classes.map((classItem) => classItem.id);

    if (classIds.length === 0) {
      return {
        classes: [],
        activeSessions: [],
      };
    }

    const since = new Date();
    since.setHours(0, 0, 0, 0);

    const until = new Date();
    until.setHours(23, 59, 59, 999);

    const sessions = await this.repo.findSessionsByClassIds(
      classIds,
      since,
      until,
    );

    const tomorrow = new Date(since);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const endOfWeek = new Date();
    const currentDay = endOfWeek.getDay();
    const daysToSunday = currentDay === 0 ? 0 : 7 - currentDay;
    endOfWeek.setDate(endOfWeek.getDate() + daysToSunday);
    endOfWeek.setHours(23, 59, 59, 999);

    const weekSessions = tomorrow <= endOfWeek
      ? await this.repo.findSessionsByClassIds(classIds, tomorrow, endOfWeek)
      : [];

    return {
      classes: classes.map((classItem) => ({
        id: classItem.id,
        name: classItem.name,
        code: classItem.code,
        room: classItem.room,
      })),

      activeSessions: sessions.map((session) => ({
        id: session.id,
        classId: session.classId,
        className: session.class.name,
        classCode: session.class.code,
        room: session.room ?? session.class.room,
        startAt: session.startAt,
        endAt: session.endAt,
        gracePeriodMinutes: session.gracePeriodMinutes,
      })),

      weekSessions: weekSessions.map((session) => ({
        id: session.id,
        classId: session.classId,
        className: session.class.name,
        classCode: session.class.code,
        room: session.room ?? session.class.room,
        startAt: session.startAt,
        endAt: session.endAt,
        gracePeriodMinutes: session.gracePeriodMinutes,
      })),
    };
  }
}

export const teacherClassService = new TeacherClassService();
