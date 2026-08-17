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

function toClassDto(cls: Class) {
  return {
    id: cls.id,
    name: cls.name,
    code: cls.code,
    room: cls.room,
    subject: cls.subject,
    lesson: cls.lesson,
    dayTime: cls.dayTime,
    capacity: cls.capacity,
    contentGroup: cls.contentGroup,
    term: cls.term
      ? (cls.term.academicYear && cls.term.yearLevel
        ? `${cls.term.name} · ${cls.term.academicYear.year} · ${cls.term.yearLevel.name}`
        : cls.term.name)
      : (cls.termName ?? "Term 3 2026"),
    termId: cls.term ? cls.term.id : null,
    teacher: cls.teacher
      ? {
          id: cls.teacher.id,
          fullName: cls.teacher.fullName,
        }
      : null,
    createdAt: cls.createdAt,
    updatedAt: cls.updatedAt,
  };
}

export class AdminClassesService {
  private readonly classes = AppDataSource.getRepository(Class);
  private readonly users = AppDataSource.getRepository(User);
  private readonly terms = AppDataSource.getRepository(Term);

  async list() {
    const list = await this.classes.find({
      relations: { teacher: true, term: { academicYear: true, yearLevel: true } },
      order: { createdAt: "DESC" },
    });
    return list.map(toClassDto);
  }

  async getById(id: string) {
    const cls = await this.classes.findOne({
      where: { id },
      relations: { teacher: true, term: { academicYear: true, yearLevel: true } },
    });
    if (!cls) {
      throw new AppError(404, "Class not found", "CLASS_NOT_FOUND");
    }
    return toClassDto(cls);
  }

  async create(input: ClassInput) {
    let teacher: User | null = null;
    if (input.teacherId) {
      teacher = await this.users.findOne({ where: { id: input.teacherId } });
    }

    let termObj: Term | null = null;
    if (input.termId) {
      termObj = await this.terms.findOne({ where: { id: input.termId } });
    } else if (input.term) {
      termObj = await this.terms.findOne({ where: { name: input.term } });
    }

    const cls = this.classes.create({
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

    await this.classes.save(cls);
    return toClassDto(cls);
  }

  async update(id: string, input: Partial<ClassInput>) {
    const cls = await this.classes.findOne({
      where: { id },
      relations: { teacher: true, term: { academicYear: true, yearLevel: true } },
    });

    if (!cls) {
      throw new AppError(404, "Class not found", "CLASS_NOT_FOUND");
    }

    if (input.teacherId !== undefined) {
      if (input.teacherId) {
        const teacher = await this.users.findOne({ where: { id: input.teacherId } });
        cls.teacher = teacher;
      } else {
        cls.teacher = null;
      }
    }

    if (input.termId !== undefined || input.term !== undefined) {
      if (input.termId) {
        const termObj = await this.terms.findOne({ where: { id: input.termId } });
        cls.term = termObj;
      } else if (input.term) {
        const termObj = await this.terms.findOne({ where: { name: input.term } });
        cls.term = termObj;
      } else {
        cls.term = null;
      }
      if (input.term !== undefined) {
        cls.termName = input.term?.trim() || null;
      }
    }

    if (input.name !== undefined && input.name) cls.name = input.name.trim();
    if (input.code !== undefined) cls.code = input.code.trim();
    if (input.room !== undefined) cls.room = input.room.trim();
    if (input.subject !== undefined) cls.subject = input.subject?.trim() || null;
    if (input.lesson !== undefined) cls.lesson = input.lesson?.trim() || null;
    if (input.dayTime !== undefined) cls.dayTime = input.dayTime?.trim() || null;
    if (input.capacity !== undefined) cls.capacity = input.capacity;
    if (input.contentGroup !== undefined) cls.contentGroup = input.contentGroup?.trim() || null;

    await this.classes.save(cls);
    return toClassDto(cls);
  }

  async bulkReplace(termId: string, classesToCreate: ClassInput[]) {
    return await AppDataSource.transaction(async (transactionManager) => {
      const repo = transactionManager.getRepository(Class);

      // 1. Fetch matching classes for the term
      const existingClasses = await repo.find({
        where: { term: { id: termId } },
      });

      if (existingClasses.length > 0) {
        const classIds = existingClasses.map((c) => c.id);

        // Check if students are enrolled
        const enrollmentCount = await transactionManager.getRepository(ClassStudent).count({
          where: { classId: In(classIds) },
        });
        if (enrollmentCount > 0) {
          throw new AppError(
            400,
            "Cannot modify timetable: students are already enrolled in classes for this term.",
            "TIMETABLE_LOCKED"
          );
        }

        // Check if session history exists
        const sessions = await transactionManager.getRepository(Session).find({
          where: { classId: In(classIds) },
        });
        if (sessions.length > 0) {
          const sessionIds = sessions.map((s) => s.id);

          const attendanceCount = await transactionManager.getRepository(AttendanceRecord).count({
            where: { sessionId: In(sessionIds) },
          });
          const scanCount = await transactionManager.getRepository(ScanEvent).count({
            where: { sessionId: In(sessionIds) },
          });
          const taskCount = await transactionManager.getRepository(Task).count({
            where: { sessionId: In(sessionIds) },
          });

          if (attendanceCount > 0 || scanCount > 0 || taskCount > 0) {
            throw new AppError(
              400,
              "Cannot modify timetable: class sessions already have attendance or task history recorded.",
              "TIMETABLE_LOCKED"
            );
          }

          // Safe to delete old sessions
          await transactionManager.getRepository(Session).remove(sessions);
        }

        // Safe to delete old classes
        await repo.remove(existingClasses);
      }

      // 2. Pre-fetch dependencies for bulk insertion
      const teacherIds = Array.from(
        new Set(classesToCreate.map((c) => c.teacherId).filter(Boolean))
      ) as string[];

      const teacherMap = new Map<string, User>();
      if (teacherIds.length > 0) {
        const teachers = await transactionManager.getRepository(User).find({
          where: { id: In(teacherIds) },
        });
        teachers.forEach((t) => teacherMap.set(t.id, t));
      }

      const termObj = await transactionManager.getRepository(Term).findOne({
        where: { id: termId },
      });

      // 3. Create all class entities synchronously
      const entities = classesToCreate.map((input) => {
        const teacher = input.teacherId ? teacherMap.get(input.teacherId) || null : null;
        return repo.create({
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

      // 4. Perform a single database bulk save
      const savedEntities = await repo.save(entities);
      return savedEntities.map(toClassDto);
    });
  }

  async remove(id: string) {
    const cls = await this.classes.findOne({ where: { id } });
    if (!cls) {
      throw new AppError(404, "Class not found", "CLASS_NOT_FOUND");
    }
    await this.classes.remove(cls);
  }
}

export const adminClassesService = new AdminClassesService();
