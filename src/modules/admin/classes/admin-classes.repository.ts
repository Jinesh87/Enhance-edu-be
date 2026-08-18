import { In } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import { AppError } from "../../../common/errors/AppError.js";
import {
  Class,
  User,
  Term,
  ClassStudent,
  Session,
  AttendanceRecord,
  ScanEvent,
  Task,
} from "../../../entities/index.js";

export type ClassInput = {
  name?: string;
  code: string;
  room: string;
  subject?: string | null;
  lesson?: string | null;
  dayTime?: string | null;
  capacity?: number;
  contentGroup?: string | null;
  term?: string | null;
  termId?: string | null;
  teacherId?: string | null;
};

export class AdminClassesRepository {
  private readonly classes = AppDataSource.getRepository(Class);
  private readonly users = AppDataSource.getRepository(User);
  private readonly terms = AppDataSource.getRepository(Term);

  async findAll(filters?: {
    page?: number;
    limit?: number;
  }): Promise<{ classes: Class[]; total: number }> {
    const findOptions: any = {
      relations: {
        teacher: true,
        term: { academicYear: true, yearLevel: true },
      },
      order: { createdAt: "DESC" },
    };
    if (filters?.page && filters?.limit) {
      findOptions.skip = (filters.page - 1) * filters.limit;
      findOptions.take = filters.limit;
    }
    const [classes, total] = await this.classes.findAndCount(findOptions);
    return { classes, total };
  }

  async findById(id: string): Promise<Class | null> {
    return this.classes.findOne({
      where: { id },
      relations: {
        teacher: true,
        term: { academicYear: true, yearLevel: true },
      },
    });
  }

  async findTeacherById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  async findTermById(id: string): Promise<Term | null> {
    return this.terms.findOne({ where: { id } });
  }

  async findTermByName(name: string): Promise<Term | null> {
    return this.terms.findOne({ where: { name } });
  }

  async create(data: Partial<Class>): Promise<Class> {
    return this.classes.create(data);
  }

  async save(cls: Class): Promise<Class> {
    return this.classes.save(cls);
  }

  async remove(cls: Class): Promise<void> {
    await this.classes.remove(cls);
  }

  async findOneSimple(id: string): Promise<Class | null> {
    return this.classes.findOne({ where: { id } });
  }

  async bulkReplace(
    termId: string,
    classesToCreate: ClassInput[],
  ): Promise<Class[]> {
    return await AppDataSource.transaction(async (transactionManager) => {
      const classRepo = transactionManager.getRepository(Class);
      const classStudentRepo = transactionManager.getRepository(ClassStudent);
      const sessionRepo = transactionManager.getRepository(Session);
      const attendanceRepo = transactionManager.getRepository(AttendanceRecord);
      const scanRepo = transactionManager.getRepository(ScanEvent);
      const taskRepo = transactionManager.getRepository(Task);
      const userRepo = transactionManager.getRepository(User);
      const termRepo = transactionManager.getRepository(Term);

      const existingClasses = await classRepo.find({
        where: { term: { id: termId } },
      });

      if (existingClasses.length > 0) {
        const classIds = existingClasses.map((c) => c.id);

        const enrollmentCount = await classStudentRepo.count({
          where: { classId: In(classIds) },
        });
        if (enrollmentCount > 0) {
          throw new AppError(
            400,
            "Cannot modify timetable: students are already enrolled in classes for this term.",
            "TIMETABLE_LOCKED",
          );
        }

        const sessions = await sessionRepo.find({
          where: { classId: In(classIds) },
        });
        if (sessions.length > 0) {
          const sessionIds = sessions.map((s) => s.id);

          const attendanceCount = await attendanceRepo.count({
            where: { sessionId: In(sessionIds) },
          });
          const scanCount = await scanRepo.count({
            where: { sessionId: In(sessionIds) },
          });
          const taskCount = await taskRepo.count({
            where: { sessionId: In(sessionIds) },
          });

          if (attendanceCount > 0 || scanCount > 0 || taskCount > 0) {
            throw new AppError(
              400,
              "Cannot modify timetable: class sessions already have attendance or task history recorded.",
              "TIMETABLE_LOCKED",
            );
          }
          await sessionRepo.remove(sessions);
        }

        await classRepo.remove(existingClasses);
      }

      const teacherIds = Array.from(
        new Set(classesToCreate.map((c) => c.teacherId).filter(Boolean)),
      ) as string[];

      const teacherMap = new Map<string, User>();
      if (teacherIds.length > 0) {
        const teachers = await userRepo.find({
          where: { id: In(teacherIds) },
        });
        teachers.forEach((t) => teacherMap.set(t.id, t));
      }

      const termObj = await termRepo.findOne({
        where: { id: termId },
      });

      const entities = classesToCreate.map((input) => {
        const teacher = input.teacherId
          ? teacherMap.get(input.teacherId) || null
          : null;
        return classRepo.create({
          name: input.name?.trim() || `${input.subject ?? "Subject"} Class`,
          code: input.code.trim(),
          room: input.room.trim(),
          subject: input.subject?.trim() || null,
          lesson: input.lesson?.trim() || null,
          dayTime: input.dayTime?.trim() || null,
          capacity: input.capacity ?? 20,
          contentGroup: input.contentGroup?.trim() || null,
          termName: input.term?.trim() || "Term 3 2026",
          term: termObj,
          teacher,
        });
      });

      return await classRepo.save(entities);
    });
  }
}

export const adminClassesRepository = new AdminClassesRepository();
