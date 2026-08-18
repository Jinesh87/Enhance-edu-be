import { AppError } from "../../../common/errors/AppError.js";
import { Class } from "../../../entities/index.js";
import {
  adminClassesRepository,
  type ClassInput,
} from "./admin-classes.repository.js";

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
      ? cls.term.academicYear && cls.term.yearLevel
        ? `${cls.term.name} · ${cls.term.academicYear.year} · ${cls.term.yearLevel.name}`
        : cls.term.name
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
  private readonly repo = adminClassesRepository;

  async list() {
    const list = await this.repo.findAll();
    return list.map(toClassDto);
  }

  async getById(id: string) {
    const cls = await this.repo.findById(id);
    if (!cls) {
      throw new AppError(404, "Class not found", "CLASS_NOT_FOUND");
    }
    return toClassDto(cls);
  }

  async create(input: ClassInput) {
    let teacher = null;
    if (input.teacherId) {
      teacher = await this.repo.findTeacherById(input.teacherId);
    }

    let termObj = null;
    if (input.termId) {
      termObj = await this.repo.findTermById(input.termId);
    } else if (input.term) {
      termObj = await this.repo.findTermByName(input.term);
    }

    const cls = await this.repo.create({
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

    await this.repo.save(cls);
    return toClassDto(cls);
  }

  async update(id: string, input: Partial<ClassInput>) {
    const cls = await this.repo.findById(id);

    if (!cls) {
      throw new AppError(404, "Class not found", "CLASS_NOT_FOUND");
    }

    if (input.teacherId !== undefined) {
      if (input.teacherId) {
        const teacher = await this.repo.findTeacherById(input.teacherId);
        cls.teacher = teacher;
      } else {
        cls.teacher = null;
      }
    }

    if (input.termId !== undefined || input.term !== undefined) {
      if (input.termId) {
        const termObj = await this.repo.findTermById(input.termId);
        cls.term = termObj;
      } else if (input.term) {
        const termObj = await this.repo.findTermByName(input.term);
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
    if (input.subject !== undefined)
      cls.subject = input.subject?.trim() || null;
    if (input.lesson !== undefined) cls.lesson = input.lesson?.trim() || null;
    if (input.dayTime !== undefined)
      cls.dayTime = input.dayTime?.trim() || null;
    if (input.capacity !== undefined) cls.capacity = input.capacity;
    if (input.contentGroup !== undefined)
      cls.contentGroup = input.contentGroup?.trim() || null;

    await this.repo.save(cls);
    return toClassDto(cls);
  }

  async bulkReplace(termId: string, classesToCreate: ClassInput[]) {
    const savedEntities = await this.repo.bulkReplace(termId, classesToCreate);
    return savedEntities.map(toClassDto);
  }

  async remove(id: string) {
    const cls = await this.repo.findOneSimple(id);
    if (!cls) {
      throw new AppError(404, "Class not found", "CLASS_NOT_FOUND");
    }
    await this.repo.remove(cls);
  }
}

export const adminClassesService = new AdminClassesService();
