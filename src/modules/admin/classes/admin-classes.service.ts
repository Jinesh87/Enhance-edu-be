import { AppError } from "../../../common/errors/AppError.js";
import { Class } from "../../../entities/index.js";
import {
  adminClassesRepository,
  type ClassInput,
} from "./admin-classes.repository.js";

function parseDayTimeStart(dayTime: string | null): Date | null {
  if (!dayTime) return null;
  const start = new Date(dayTime.split(" ")[0]);
  return Number.isNaN(start.getTime()) ? null : start;
}

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

  async list(filters?: {
    page?: number;
    limit?: number;
    search?: string;
    year?: number;
    yearLevel?: string;
    term?: string;
  }) {
    const { classes } = await this.repo.findAll();

    let filteredClasses = classes;
    if (filters?.search) {
      const searchNeedle = filters.search.trim().toLowerCase();
      filteredClasses = filteredClasses.filter((c) => {
        const subject = (c.subject || "").toLowerCase();
        return subject.includes(searchNeedle);
      });
    }

    if (filters?.year) {
      filteredClasses = filteredClasses.filter((c) => {
        return c.term?.academicYear?.year === filters.year;
      });
    }

    if (filters?.yearLevel) {
      const lvlNeedle = filters.yearLevel.trim().toLowerCase();
      filteredClasses = filteredClasses.filter((c) => {
        const lvlName = c.term?.yearLevel?.name?.toLowerCase() || "";
        return lvlName.includes(lvlNeedle);
      });
    }

    if (filters?.term) {
      const termNeedle = filters.term.trim().toLowerCase();
      filteredClasses = filteredClasses.filter((c) => {
        const tName = c.term?.name?.toLowerCase() || "";
        return tName.includes(termNeedle);
      });
    }

    const groupedMap = new Map<string, any>();
    for (const c of filteredClasses) {
      const subjectName = c.subject || "General";
      const termName = c.term
        ? c.term.academicYear && c.term.yearLevel
          ? `${c.term.name} · ${c.term.academicYear.year} · ${c.term.yearLevel.name}`
          : c.term.name
        : (c.termName ?? "Term 3 2026");
      const key = `${subjectName}|${termName}`;

      let durationMins = 60;
      if (c.dayTime) {
        const parts = c.dayTime.split(" ");
        if (parts.length > 0) {
          const startTimeStr = parts[0];
          const tIndex = startTimeStr.indexOf("T");
          if (tIndex !== -1) {
            const timeStr = startTimeStr.slice(tIndex + 1, tIndex + 6);
            const endTimeStr = parts[1] || "";
            if (endTimeStr) {
              const [sh, sm] = timeStr.split(":").map(Number);
              const [eh, em] = endTimeStr.split(":").map(Number);
              const diff = eh * 60 + em - (sh * 60 + sm);
              if (diff > 0) durationMins = diff;
            }
          }
        }
      }

      const sessionDate = parseDayTimeStart(c.dayTime);

      if (!groupedMap.has(key)) {
        groupedMap.set(key, {
          subject: subjectName,
          term: termName,
          sessionCount: 0,
          totalDurationMinutes: 0,
          teachers: new Set<string>(),
          enrolled: 0,
          needAttention: 0,
          dayTime: c.dayTime || "",
          startDate: sessionDate,
          endDate: sessionDate,
        });
      }

      const group = groupedMap.get(key);
      group.sessionCount += 1;
      group.totalDurationMinutes += durationMins;
      if (c.teacher?.fullName) {
        group.teachers.add(c.teacher.fullName);
      }
      if (sessionDate) {
        if (!group.startDate || sessionDate < group.startDate) {
          group.startDate = sessionDate;
        }
        if (!group.endDate || sessionDate > group.endDate) {
          group.endDate = sessionDate;
        }
      }
    }

    const summaries = Array.from(groupedMap.values()).map((g) => ({
      subject: g.subject,
      term: g.term,
      sessionCount: g.sessionCount,
      totalDurationMinutes: g.totalDurationMinutes,
      teachers: Array.from(g.teachers),
      enrolled: g.enrolled,
      needAttention: g.needAttention,
      dayTime: g.dayTime,
      startDate: g.startDate,
      endDate: g.endDate,
    }));

    const total = summaries.length;
    let paginated = summaries;
    if (filters?.page && filters?.limit) {
      const start = (filters.page - 1) * filters.limit;
      paginated = summaries.slice(start, start + filters.limit);
    }

    return {
      classes: classes.map(toClassDto),
      summaries: paginated,
      total,
    };
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
