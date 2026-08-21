import { AppError } from "../../../common/errors/AppError.js";
import { parseDayTime, resolveIanaTimeZone } from "../../../common/utils/timezone.js";
import { Class, Classroom } from "../../../entities/index.js";
import { AppDataSource } from "../../../config/data-source.js";
import {
  adminClassesRepository,
  type ClassInput,
} from "./admin-classes.repository.js";

function parseDayTimeStart(dayTime: string | null, timeZone?: string | null): Date | null {
  return parseDayTime(dayTime, timeZone)?.startAt ?? null;
}

function toClassDto(cls: Class, gracePeriodMinutes?: number | null) {
  return {
    id: cls.id,
    name: cls.name,
    code: cls.code,
    room: cls.room,
    classroomId: cls.classroomId ?? cls.classroom?.id ?? null,
    subject: cls.subject,
    lesson: cls.lesson,
    dayTime: cls.dayTime,
    timeZone: resolveIanaTimeZone(cls.timeZone),
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
    gracePeriodMinutes: gracePeriodMinutes ?? null,
    createdAt: cls.createdAt,
    updatedAt: cls.updatedAt,
  };
}

export class AdminClassesService {
  private readonly repo = adminClassesRepository;
  private readonly classrooms = AppDataSource.getRepository(Classroom);

  private async resolveClassroom(
    classroomId: string | null | undefined,
    options: { required: boolean; requireActive: boolean },
  ): Promise<Classroom | null> {
    if (!classroomId) {
      if (options.required) {
        throw new AppError(
          400,
          "Classroom is required",
          "CLASSROOM_REQUIRED",
        );
      }
      return null;
    }

    const classroom = await this.classrooms.findOne({
      where: { id: classroomId },
    });
    if (!classroom) {
      throw new AppError(404, "Classroom not found", "CLASSROOM_NOT_FOUND");
    }
    if (options.requireActive && !classroom.isActive) {
      throw new AppError(
        400,
        "This classroom is inactive and cannot be assigned",
        "CLASSROOM_INACTIVE",
      );
    }
    return classroom;
  }

  private async applyClassroomToInput(
    input: ClassInput,
    options: { required: boolean; requireActive: boolean },
  ): Promise<ClassInput> {
    const classroom = await this.resolveClassroom(input.classroomId, options);
    if (!classroom) {
      return {
        ...input,
        classroomId: null,
        room: "",
      };
    }
    return {
      ...input,
      classroomId: classroom.id,
      room: classroom.name,
    };
  }

  private classTermLabel(cls: Class): string | null {
    if (cls.term?.academicYear && cls.term.yearLevel) {
      return `${cls.term.name} · ${cls.term.academicYear.year} · ${cls.term.yearLevel.name}`;
    }
    return cls.term?.name ?? cls.termName ?? null;
  }

  private occupancyTimes(dayTime?: string | null, timeZone?: string | null) {
    return parseDayTime(dayTime ?? null, timeZone);
  }

  private async assertClassroomAvailable(
    classroomId: string,
    dayTime: string | null | undefined,
    timeZone: string | null | undefined,
    excludeClassIds: string[] = [],
  ) {
    const proposed = this.occupancyTimes(dayTime, timeZone);
    if (!proposed) return;

    const occupied = await this.repo.findByClassroomId(classroomId);
    const exclude = new Set(excludeClassIds);
    const conflict = occupied.find((cls) => {
      if (exclude.has(cls.id)) return false;
      const existing = this.occupancyTimes(cls.dayTime, cls.timeZone);
      if (!existing) return false;
      return (
        proposed.startAt.getTime() < existing.endAt.getTime() &&
        existing.startAt.getTime() < proposed.endAt.getTime()
      );
    });

    if (!conflict) return;

    const subject = conflict.subject?.trim() || "another class";
    const termLabel = this.classTermLabel(conflict);
    throw new AppError(
      409,
      termLabel
        ? `Classroom is already assigned to ${subject} (${termLabel}) at this time`
        : `Classroom is already assigned to ${subject} at this time`,
      "CLASSROOM_OCCUPIED",
    );
  }

  private assertNoInternalClassroomOverlap(inputs: ClassInput[]) {
    const slots = inputs
      .map((input, index) => {
        if (!input.classroomId) return null;
        const times = this.occupancyTimes(input.dayTime, input.timeZone);
        if (!times) return null;
        return {
          index,
          classroomId: input.classroomId,
          subject: input.subject?.trim() || "another class",
          startMs: times.startAt.getTime(),
          endMs: times.endAt.getTime(),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const left = slots[i];
        const right = slots[j];
        if (left.classroomId !== right.classroomId) continue;
        if (left.startMs >= right.endMs || right.startMs >= left.endMs) {
          continue;
        }
        throw new AppError(
          409,
          `Classroom is already assigned to ${right.subject} at this time`,
          "CLASSROOM_OCCUPIED",
        );
      }
    }
  }

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

    const studentsByClassId = await this.repo.findStudentIdsByClassIds(
      filteredClasses.map((item) => item.id),
    );

    const groupedMap = new Map<
      string,
      {
        subject: string;
        term: string;
        sessionCount: number;
        totalDurationMinutes: number;
        teachers: Set<string>;
        studentIds: Set<string>;
        needAttention: number;
        dayTime: string;
        startDate: Date | null;
        endDate: Date | null;
      }
    >();
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

      const sessionDate = parseDayTimeStart(c.dayTime, c.timeZone);

      if (!groupedMap.has(key)) {
        groupedMap.set(key, {
          subject: subjectName,
          term: termName,
          sessionCount: 0,
          totalDurationMinutes: 0,
          teachers: new Set<string>(),
          studentIds: new Set<string>(),
          needAttention: 0,
          dayTime: c.dayTime || "",
          startDate: sessionDate,
          endDate: sessionDate,
        });
      }

      const group = groupedMap.get(key);
      if (!group) {
        continue;
      }
      group.sessionCount += 1;
      group.totalDurationMinutes += durationMins;
      if (c.teacher?.fullName) {
        group.teachers.add(c.teacher.fullName);
      }
      const enrolledStudentIds = studentsByClassId.get(c.id) ?? [];
      for (const studentId of enrolledStudentIds) {
        group.studentIds.add(studentId);
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
      enrolled: g.studentIds.size,
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

    const graceByClassId = await this.repo.findGraceMinutesByClassIds(
      classes.map((item) => item.id),
    );

    return {
      classes: classes.map((item) =>
        toClassDto(item, graceByClassId.get(item.id) ?? null),
      ),
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
    let termObj = null;
    if (input.termId) {
      termObj = await this.repo.findTermById(input.termId);
    } else if (input.term) {
      termObj = await this.repo.findTermByName(input.term);
    }

    const resolved = await this.applyClassroomToInput(
      {
        ...input,
        classroomId: termObj?.classroomId ?? null,
      },
      {
        required: false,
        requireActive: Boolean(termObj?.classroomId),
      },
    );

    let teacher = null;
    if (resolved.teacherId) {
      teacher = await this.repo.findTeacherById(resolved.teacherId);
    }

    const cls = await this.repo.create({
      name: resolved.name?.trim() || `${resolved.subject ?? "Subject"} Class`,
      code: resolved.code.trim(),
      room: (resolved.room ?? "").trim(),
      classroomId: resolved.classroomId ?? null,
      subject: resolved.subject?.trim() || null,
      lesson: resolved.lesson?.trim() || null,
      dayTime: resolved.dayTime?.trim() || null,
      timeZone: resolveIanaTimeZone(resolved.timeZone),
      capacity: resolved.capacity ?? 20,
      contentGroup: resolved.contentGroup?.trim() || null,
      termName: resolved.term?.trim() || "Term 3 2026",
      term: termObj,
      teacher,
    });

    if (resolved.classroomId) {
      await this.assertClassroomAvailable(
        resolved.classroomId,
        cls.dayTime,
        cls.timeZone,
      );
    }

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
    if (input.classroomId !== undefined) {
      const classroom = await this.resolveClassroom(input.classroomId, {
        required: false,
        requireActive: Boolean(input.classroomId),
      });
      cls.classroomId = classroom?.id ?? null;
      cls.room = classroom?.name ?? "";
    } else if (input.room !== undefined && input.room !== null) {
      cls.room = input.room.trim();
    }
    if (input.subject !== undefined)
      cls.subject = input.subject?.trim() || null;
    if (input.lesson !== undefined) cls.lesson = input.lesson?.trim() || null;
    if (input.dayTime !== undefined)
      cls.dayTime = input.dayTime?.trim() || null;
    if (input.timeZone !== undefined)
      cls.timeZone = resolveIanaTimeZone(input.timeZone);
    if (input.capacity !== undefined) cls.capacity = input.capacity;
    if (input.contentGroup !== undefined)
      cls.contentGroup = input.contentGroup?.trim() || null;

    if (
      cls.classroomId &&
      (input.classroomId !== undefined ||
        input.dayTime !== undefined ||
        input.timeZone !== undefined)
    ) {
      await this.assertClassroomAvailable(
        cls.classroomId,
        cls.dayTime,
        cls.timeZone,
        [cls.id],
      );
    }

    await this.repo.save(cls);
    if (input.classroomId !== undefined) {
      await this.repo.updateSessionClassroom(
        cls.id,
        cls.classroomId,
        cls.room || null,
      );
    }
    return toClassDto(cls);
  }

  async bulkReplace(
    termId: string,
    classesToCreate: ClassInput[],
    gracePeriodMinutes?: number,
  ) {
    const termObj = await this.repo.findTermById(termId);
    const termClassroomId = termObj?.classroomId ?? null;
    const resolved = await Promise.all(
      classesToCreate.map((item) =>
        this.applyClassroomToInput(
          { ...item, classroomId: termClassroomId },
          {
            required: false,
            requireActive: Boolean(termClassroomId),
          },
        ),
      ),
    );
    this.assertNoInternalClassroomOverlap(resolved);
    const existingInTerm = (await this.repo.findAll()).classes.filter(
      (item) => item.term?.id === termId,
    );
    const excludeIds = existingInTerm.map((item) => item.id);
    for (const item of resolved) {
      if (!item.classroomId) continue;
      await this.assertClassroomAvailable(
        item.classroomId,
        item.dayTime,
        item.timeZone,
        excludeIds,
      );
    }
    const savedEntities = await this.repo.bulkReplace(
      termId,
      resolved,
      gracePeriodMinutes,
    );
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
