import { AppError } from "../../../common/errors/AppError.js";
import {
  calendarDateInTimeZone,
  parseDayTime,
  resolveIanaTimeZone,
} from "../../../common/utils/timezone.js";
import { buildScheduleSlotKey } from "../../../common/utils/schedule-slot.js";
import {
  sessionStatus,
  type SessionStatus,
} from "../../../common/utils/session-status.js";
import {
  Class,
  Classroom,
  Session,
  AttendanceRecord,
  AttendanceStatus,
  ClassStudent,
  ScanEvent,
  Task,
} from "../../../entities/index.js";
import { AppDataSource } from "../../../config/data-source.js";
import { In, IsNull, Not } from "typeorm";
import {
  adminClassesRepository,
  type ClassInput,
} from "./admin-classes.repository.js";
import { syncClassRosterFromEnrollments } from "../../shared/classes/sync-class-roster.js";
import { applySequentialLessonLabels } from "../../../common/utils/session-lesson-labels.js";

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
    proposedSubject?: string | null,
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
      {
        field: "time",
        subject,
        proposedSubject: proposedSubject?.trim() || null,
      },
    );
  }

  private async assertTeacherAvailable(
    teacherId: string,
    dayTime: string | null | undefined,
    timeZone: string | null | undefined,
    excludeClassIds: string[] = [],
    proposedSubject?: string | null,
  ) {
    const proposed = this.occupancyTimes(dayTime, timeZone);
    if (!proposed) return;

    const { classes } = await this.repo.findAll();
    const exclude = new Set(excludeClassIds);
    const conflict = classes.find((cls) => {
      if (exclude.has(cls.id)) return false;
      if (cls.teacher?.id !== teacherId) return false;
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
        ? `Teacher is already assigned to ${subject} (${termLabel}) at this time`
        : `Teacher is already assigned to ${subject} at this time`,
      "TEACHER_OCCUPIED",
      {
        field: "teacherId",
        conflictSubject: subject,
        proposedSubject: proposedSubject?.trim() || null,
      },
    );
  }

  private async assertTermScheduleAvailable(
    termId: string | null | undefined,
    termName: string | null | undefined,
    dayTime: string | null | undefined,
    timeZone: string | null | undefined,
    excludeClassIds: string[] = [],
    proposedSubject?: string | null,
  ) {
    const proposed = this.occupancyTimes(dayTime, timeZone);
    if (!proposed) return;

    const { classes } = await this.repo.findAll();
    const exclude = new Set(excludeClassIds);
    const termNeedle = (termName ?? "").trim().toLowerCase();

    const conflict = classes.find((cls) => {
      if (exclude.has(cls.id)) return false;
      const sameTerm =
        (termId && cls.term?.id && cls.term.id === termId) ||
        (termNeedle &&
          (cls.term?.name || cls.termName || "").trim().toLowerCase() ===
            termNeedle);
      if (!sameTerm) return false;

      const existing = this.occupancyTimes(cls.dayTime, cls.timeZone);
      if (!existing) return false;
      return (
        proposed.startAt.getTime() < existing.endAt.getTime() &&
        existing.startAt.getTime() < proposed.endAt.getTime()
      );
    });

    if (!conflict) return;

    const subject = conflict.subject?.trim() || "another class";
    throw new AppError(
      409,
      `Time overlaps ${subject} at this time`,
      "CLASS_SCHEDULE_OVERLAP",
      {
        field: "startTime",
        conflictSubject: subject,
        proposedSubject: proposedSubject?.trim() || null,
      },
    );
  }

  private assertNoInternalScheduleOverlap(inputs: ClassInput[]) {
    const slots = inputs
      .map((input) => {
        const times = this.occupancyTimes(input.dayTime, input.timeZone);
        if (!times) return null;
        return {
          subject: input.subject?.trim() || "another session",
          teacherId: input.teacherId || null,
          startMs: times.startAt.getTime(),
          endMs: times.endAt.getTime(),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const left = slots[i];
        const right = slots[j];
        if (left.startMs >= right.endMs || right.startMs >= left.endMs) {
          continue;
        }

        const field =
          left.teacherId && left.teacherId === right.teacherId
            ? "teacherId"
            : "time";
        const message =
          field === "teacherId"
            ? `Teacher has a time conflict with ${left.subject}`
            : `${right.subject} overlaps ${left.subject} at this time`;

        throw new AppError(409, message, "CLASS_SCHEDULE_OVERLAP", {
          field,
          subjects: [left.subject, right.subject],
        });
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

    await Promise.all(
      filteredClasses.map((cls) => syncClassRosterFromEnrollments(cls)),
    );
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
      filteredClasses.map((item) => item.id),
    );

    return {
      classes: filteredClasses.map((item) =>
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

  async listEnrolledStudents(id: string) {
    const cls = await this.repo.findById(id);
    if (!cls) {
      throw new AppError(404, "Class not found", "CLASS_NOT_FOUND");
    }
    const students = await this.repo.findEnrolledStudents(id);
    return { students };
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
        classroomId: input.classroomId ?? termObj?.classroomId ?? null,
      },
      {
        required: false,
        requireActive: Boolean(input.classroomId ?? termObj?.classroomId),
      },
    );

    let teacher = null;
    if (resolved.teacherId) {
      teacher = await this.repo.findTeacherById(resolved.teacherId);
    }

    const code =
      resolved.code?.trim() ||
      `${(resolved.subject ?? "CLS").replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 4) || "CLS"}-${Date.now().toString(36).toUpperCase()}`;

    const cls = await this.repo.create({
      name: resolved.name?.trim() || `${resolved.subject ?? "Subject"} Class`,
      code,
      room: (resolved.room ?? "").trim(),
      classroomId: resolved.classroomId ?? null,
      subject: resolved.subject?.trim() || null,
      lesson: resolved.lesson?.trim() || null,
      dayTime: resolved.dayTime?.trim() || null,
      timeZone: resolveIanaTimeZone(resolved.timeZone),
      capacity: resolved.capacity ?? 20,
      contentGroup: resolved.contentGroup?.trim() || null,
      termName: resolved.term?.trim() || (termObj ? termObj.name : "Term 3 2026"),
      term: termObj,
      teacher,
    });

    if (resolved.classroomId) {
      await this.assertClassroomAvailable(
        resolved.classroomId,
        cls.dayTime,
        cls.timeZone,
        [],
        resolved.subject,
      );
    }

    if (resolved.teacherId) {
      await this.assertTeacherAvailable(
        resolved.teacherId,
        cls.dayTime,
        cls.timeZone,
        [],
        resolved.subject,
      );
    }

    await this.assertTermScheduleAvailable(
      cls.term?.id,
      cls.term?.name ?? cls.termName,
      cls.dayTime,
      cls.timeZone,
      [],
      resolved.subject,
    );

    const saved = await this.repo.save(cls);

    // Sync roster from enrollments
    await syncClassRosterFromEnrollments(saved);

    // Generate Session entity in sessions table for calendar and timetable
    if (saved.dayTime) {
      const times = parseDayTime(saved.dayTime, saved.timeZone);
      if (times) {
        const sessionRepo = AppDataSource.getRepository(Session);
        const attendanceRepo = AppDataSource.getRepository(AttendanceRecord);
        const classStudentRepo = AppDataSource.getRepository(ClassStudent);

        const newSession = await sessionRepo.save(
          sessionRepo.create({
            classId: saved.id,
            startAt: times.startAt,
            endAt: times.endAt,
            room: saved.room || null,
            classroomId: saved.classroomId || null,
            teacherId: saved.teacher?.id || null,
            gracePeriodMinutes: resolved.gracePeriodMinutes ?? 25,
          }),
        );

        const enrolments = await classStudentRepo.find({
          where: { classId: saved.id },
        });
        for (const enrol of enrolments) {
          await attendanceRepo.save(
            attendanceRepo.create({
              sessionId: newSession.id,
              studentId: enrol.studentId,
              status: AttendanceStatus.PENDING,
              scannedAt: null,
            }),
          );
        }
      }
    }

    return toClassDto(saved);
  }

  async update(
    id: string,
    input: Partial<ClassInput> & {
      applyTeacherToSessionIds?: string[];
    },
  ) {
    const cls = await this.repo.findById(id);

    if (!cls) {
      throw new AppError(404, "Class not found", "CLASS_NOT_FOUND");
    }

    if (input.teacherId !== undefined) {
      const previousTeacher = cls.teacher ?? null;
      // Keep historical teacher on live/ended occurrences before changing the class.
      await this.freezeTeacherOnLockedSessions(cls.id, previousTeacher);

      if (input.applyTeacherToSessionIds !== undefined) {
        await this.applySelectiveTeacherToUpcomingSessions(
          cls.id,
          previousTeacher,
          input.teacherId || null,
          input.applyTeacherToSessionIds,
        );
      } else {
        // Upcoming sessions follow the new class teacher (clear per-session overrides).
        await this.clearTeacherOverridesOnUpcomingSessions(cls.id);
      }

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
        cls.subject,
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
    this.assertNoInternalScheduleOverlap(resolved);
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
        item.subject,
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

  async listCalendarSessions(filters?: {
    year?: number;
    term?: string;
    yearLevel?: string;
    from?: string;
    to?: string;
    teacherId?: string;
    subject?: string;
  }) {
    const qb = AppDataSource.getRepository(Session)
      .createQueryBuilder("session")
      .innerJoinAndSelect("session.class", "class")
      .leftJoinAndSelect("class.teacher", "classTeacher")
      .leftJoinAndSelect("class.term", "term")
      .leftJoinAndSelect("term.academicYear", "academicYear")
      .leftJoinAndSelect("term.yearLevel", "yearLevel")
      .leftJoinAndSelect("class.classroom", "classClassroom")
      .leftJoinAndSelect("session.classroom", "sessionClassroom")
      .leftJoinAndSelect("session.teacher", "sessionTeacher")
      .where("session.assessmentId IS NULL");

    if (filters?.year != null && !Number.isNaN(filters.year)) {
      qb.andWhere("academicYear.year = :year", { year: filters.year });
    }
    if (filters?.term?.trim()) {
      qb.andWhere("LOWER(term.name) LIKE :term", {
        term: `%${filters.term.trim().toLowerCase()}%`,
      });
    }
    if (filters?.yearLevel?.trim()) {
      qb.andWhere("yearLevel.name = :yearLevel", {
        yearLevel: filters.yearLevel.trim(),
      });
    }
    if (filters?.teacherId?.trim()) {
      qb.andWhere(
        "(session.teacherId = :teacherId OR (session.teacherId IS NULL AND class.teacherId = :teacherId))",
        { teacherId: filters.teacherId.trim() },
      );
    }
    if (filters?.subject?.trim()) {
      qb.andWhere("class.subject = :subject", {
        subject: filters.subject.trim(),
      });
    }
    if (filters?.from && /^\d{4}-\d{2}-\d{2}$/.test(filters.from)) {
      qb.andWhere("session.startAt >= :fromAt", {
        fromAt: new Date(`${filters.from}T00:00:00.000`),
      });
    }
    if (filters?.to && /^\d{4}-\d{2}-\d{2}$/.test(filters.to)) {
      const toParts = filters.to.split("-").map(Number);
      const toExclusive = new Date(
        toParts[0],
        toParts[1] - 1,
        toParts[2] + 1,
        0,
        0,
        0,
        0,
      );
      qb.andWhere("session.startAt < :toExclusive", { toExclusive });
    }

    qb.orderBy("session.startAt", "ASC");

    const sessionRows = await qb.getMany();

    return {
      sessions: applySequentialLessonLabels(
        this.dedupeCalendarSessions(sessionRows).map((row) =>
          this.toCalendarListRow(row),
        ),
      ),
    };
  }

  /** Slim row for calendar grids — display fields only, no nested class. */
  private toCalendarListRow(row: Session) {
    const teacher = row.teacher ?? row.class?.teacher ?? null;
    const term = row.class?.term ?? null;
    const subject = row.class?.subject ?? null;
    const termId = term?.id ?? null;
    const termLabel = term?.name ?? row.class?.termName ?? null;
    const timeZone = resolveIanaTimeZone(row.class?.timeZone);
    return {
      id: row.id,
      classId: row.classId,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      room: row.room ?? row.class?.room ?? row.classroom?.name ?? null,
      classroomId:
        row.classroomId ??
        row.classroom?.id ??
        row.class?.classroomId ??
        null,
      teacherId: teacher?.id ?? null,
      teacher: teacher
        ? { id: teacher.id, fullName: teacher.fullName }
        : null,
      gracePeriodMinutes: row.gracePeriodMinutes,
      status: sessionStatus(row.startAt, row.endAt),
      isWeeklySlot: false,
      subject,
      lesson: null as string | null,
      termId,
      termLabel,
      yearGroup: term?.yearLevel?.name ?? null,
      timeZone,
    };
  }

  async getSession(sessionId: string) {
    const session = await AppDataSource.getRepository(Session).findOne({
      where: { id: sessionId },
      relations: {
        class: {
          teacher: true,
          term: { academicYear: true, yearLevel: true },
          classroom: true,
        },
        classroom: true,
        teacher: true,
      },
    });
    if (!session || session.assessmentId) {
      throw new AppError(404, "Session not found", "SESSION_NOT_FOUND");
    }
    return this.toSessionRow(session);
  }

  private dedupeCalendarSessions(sessions: Session[]): Session[] {
    const seen = new Map<string, Session>();
    for (const session of sessions) {
      const termId = session.class?.term?.id ?? "";
      const slotKey = session.class ? buildScheduleSlotKey(session.class) : null;
      const key = slotKey ? `${termId}|${slotKey}` : session.id;
      if (!seen.has(key)) {
        seen.set(key, session);
      }
    }
    return Array.from(seen.values()).sort(
      (a, b) => a.startAt.getTime() - b.startAt.getTime(),
    );
  }

  async listGroupSessions(
    subject: string,
    term: string,
    options: {
      page?: number;
      limit?: number;
      status?: "ALL" | SessionStatus;
      search?: string;
      startDate?: string;
      endDate?: string;
    } = {},
  ) {
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(options.limit) || 10));
    const statusFilter = options.status ?? "ALL";
    const search = (options.search ?? "").trim().toLowerCase();

    const subjectNeedle = subject.trim().toLowerCase();
    const termNeedle = term.trim().toLowerCase();
    const { classes } = await this.repo.findAll();
    const matching = classes.filter((cls) => {
      const subjectName = (cls.subject || "General").trim().toLowerCase();
      const termLabel = (this.classTermLabel(cls) || "").trim().toLowerCase();
      return subjectName === subjectNeedle && termLabel === termNeedle;
    });

    const termId = matching[0]?.term?.id ?? null;
    const classDtos = matching.map((cls) => toClassDto(cls));

    if (matching.length === 0) {
      return {
        subject: subject.trim(),
        term: term.trim(),
        termId: null,
        classes: [],
        sessions: [],
        total: 0,
        page,
        limit,
      };
    }

    const classIds = matching.map((cls) => cls.id);
    const sessionRows = await AppDataSource.getRepository(Session).find({
      where: { classId: In(classIds), assessmentId: IsNull() },
      relations: {
        class: {
          teacher: true,
          term: { academicYear: true, yearLevel: true },
          classroom: true,
        },
        classroom: true,
        teacher: true,
      },
      order: { startAt: "ASC" },
    });

    let sessions =
      sessionRows.length > 0
        ? sessionRows.map((row) => this.toSessionRow(row))
        : matching
            .map((cls) => {
              const times = parseDayTime(cls.dayTime, cls.timeZone);
              if (!times) return null;
              return {
                id: cls.id,
                classId: cls.id,
                startAt: times.startAt.toISOString(),
                endAt: times.endAt.toISOString(),
                room: cls.room || cls.classroom?.name || null,
                classroomId: cls.classroomId ?? cls.classroom?.id ?? null,
                teacherId: cls.teacher?.id ?? null,
                teacher: cls.teacher
                  ? { id: cls.teacher.id, fullName: cls.teacher.fullName }
                  : null,
                gracePeriodMinutes: 25,
                status: "SCHEDULED" as SessionStatus,
                isWeeklySlot: true,
                class: toClassDto(cls),
              };
            })
            .filter((row): row is NonNullable<typeof row> => row !== null);

    sessions = applySequentialLessonLabels(sessions);

    if (statusFilter !== "ALL") {
      sessions = sessions.filter((row) => row.status === statusFilter);
    }

    if (search) {
      sessions = sessions.filter((row) => {
        const haystack = [
          row.class?.subject,
          row.class?.lesson,
          row.class?.code,
          row.teacher?.fullName,
          row.class?.teacher?.fullName,
          row.room,
          row.class?.room,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(search);
      });
    }

    const startDate = (options.startDate ?? "").trim();
    const endDate = (options.endDate ?? "").trim();
    if (startDate || endDate) {
      sessions = sessions.filter((row) => {
        const timeZone = row.class?.timeZone ?? resolveIanaTimeZone(null);
        const localDate = calendarDateInTimeZone(new Date(row.startAt), timeZone);
        if (startDate && localDate < startDate) return false;
        if (endDate && localDate > endDate) return false;
        return true;
      });
    }

    const total = sessions.length;
    const start = (page - 1) * limit;
    const pageRows = sessions.slice(start, start + limit);

    return {
      subject: subject.trim(),
      term: term.trim(),
      termId,
      classes: classDtos,
      sessions: pageRows,
      total,
      page,
      limit,
    };
  }

  private toSessionRow(row: Session) {
    const classDto = row.class
      ? toClassDto(row.class, row.gracePeriodMinutes)
      : null;
    const teacher =
      row.teacher
        ? { id: row.teacher.id, fullName: row.teacher.fullName }
        : classDto?.teacher
          ? { id: classDto.teacher.id, fullName: classDto.teacher.fullName }
          : null;
    return {
      id: row.id,
      classId: row.classId,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      room: row.room ?? row.class?.room ?? row.classroom?.name ?? null,
      classroomId: row.classroomId ?? row.classroom?.id ?? null,
      teacherId: teacher?.id ?? null,
      teacher,
      gracePeriodMinutes: row.gracePeriodMinutes,
      status: sessionStatus(row.startAt, row.endAt),
      isWeeklySlot: false,
      class: classDto,
    };
  }

  /**
   * Edits a single upcoming/scheduled session only.
   * Never updates the class template or other sessions (including live/ended).
   */
  async updateSession(
    sessionId: string,
    input: {
      startAt?: string;
      endAt?: string;
      room?: string | null;
      classroomId?: string | null;
      teacherId?: string | null;
      gracePeriodMinutes?: number;
      classId?: string;
      isWeeklySlot?: boolean;
    },
  ) {
    if (input.isWeeklySlot) {
      const classId = input.classId || sessionId;
      return this.updateWeeklySlotClass(classId, input);
    }

    const sessionRepo = AppDataSource.getRepository(Session);
    const session = await sessionRepo.findOne({
      where: { id: sessionId },
      relations: {
        class: {
          teacher: true,
          term: { academicYear: true, yearLevel: true },
          classroom: true,
        },
        classroom: true,
        teacher: true,
      },
    });
    if (!session) {
      throw new AppError(404, "Session not found", "SESSION_NOT_FOUND");
    }

    const status = sessionStatus(session.startAt, session.endAt);
    if (status === "LIVE" || status === "ENDED") {
      throw new AppError(
        400,
        "Live and ended sessions cannot be edited",
        "SESSION_NOT_EDITABLE",
      );
    }

    if (input.startAt) session.startAt = new Date(input.startAt);
    if (input.endAt) session.endAt = new Date(input.endAt);
    if (session.endAt.getTime() <= session.startAt.getTime()) {
      throw new AppError(
        400,
        "Session end time must be after start time",
        "INVALID_SESSION_TIMES",
      );
    }

    if (input.gracePeriodMinutes !== undefined) {
      session.gracePeriodMinutes = input.gracePeriodMinutes;
    }

    if (input.classroomId !== undefined) {
      const classroom = await this.resolveClassroom(input.classroomId, {
        required: false,
        requireActive: Boolean(input.classroomId),
      });
      session.classroomId = classroom?.id ?? null;
      session.classroom = classroom;
      session.room = classroom?.name ?? (input.room?.trim() || null);
    } else if (input.room !== undefined) {
      session.room = input.room?.trim() || null;
    }

    if (input.teacherId !== undefined) {
      if (input.teacherId) {
        const teacher = await this.repo.findTeacherById(input.teacherId);
        if (!teacher) {
          throw new AppError(404, "Teacher not found", "TEACHER_NOT_FOUND");
        }
        session.teacherId = teacher.id;
        session.teacher = teacher;
      } else {
        session.teacherId = null;
        session.teacher = null;
      }
    }

    await this.assertSessionScheduleAvailable(
      session,
      session.startAt,
      session.endAt,
      session.teacherId ?? session.class?.teacher?.id ?? null,
      session.classroomId ?? session.class?.classroomId ?? null,
      session.room ?? session.class?.room ?? null,
    );

    await sessionRepo.save(session);
    const saved = await sessionRepo.findOne({
      where: { id: session.id },
      relations: {
        class: {
          teacher: true,
          term: { academicYear: true, yearLevel: true },
          classroom: true,
        },
        classroom: true,
        teacher: true,
      },
    });
    if (!saved) {
      throw new AppError(404, "Session not found", "SESSION_NOT_FOUND");
    }
    return this.toSessionRow(saved);
  }

  private getSessionDeletionBlockReason(
    session: Session,
    lockedSessionIds: Set<string>,
  ): string | null {
    if (session.assessmentId) {
      return "Assessment sessions cannot be deleted here";
    }

    const status = sessionStatus(session.startAt, session.endAt);
    if (status === "LIVE" || status === "ENDED") {
      return "Live and ended sessions cannot be deleted";
    }

    if (lockedSessionIds.has(session.id)) {
      return "Session has attendance, check-ins, or linked tasks";
    }

    return null;
  }

  private async getLockedSessionIds(sessionIds: string[]): Promise<Set<string>> {
    if (sessionIds.length === 0) {
      return new Set();
    }

    const lockedSessionIds = new Set<string>();
    const attendanceRepo = AppDataSource.getRepository(AttendanceRecord);
    const scanRepo = AppDataSource.getRepository(ScanEvent);
    const taskRepo = AppDataSource.getRepository(Task);

    const [attendanceRecords, scanEvents, tasks] = await Promise.all([
      attendanceRepo.find({
        where: {
          sessionId: In(sessionIds),
          status: Not(AttendanceStatus.PENDING),
        },
        select: { sessionId: true },
      }),
      scanRepo.find({
        where: { sessionId: In(sessionIds) },
        select: { sessionId: true },
      }),
      taskRepo.find({
        where: { sessionId: In(sessionIds) },
        select: { sessionId: true },
      }),
    ]);

    for (const record of attendanceRecords) {
      lockedSessionIds.add(record.sessionId);
    }
    for (const record of scanEvents) {
      lockedSessionIds.add(record.sessionId);
    }
    for (const record of tasks) {
      lockedSessionIds.add(record.sessionId);
    }

    return lockedSessionIds;
  }

  /**
   * Deletes upcoming/scheduled sessions that have no recorded activity.
   * Returns per-id results so bulk operations can partially succeed.
   */
  async removeSessions(sessionIds: string[]) {
    const uniqueIds = Array.from(new Set(sessionIds));
    if (uniqueIds.length === 0) {
      return { deleted: 0, deletedIds: [] as string[], skipped: [] as Array<{ id: string; reason: string }> };
    }

    const sessionRepo = AppDataSource.getRepository(Session);
    const sessions = await sessionRepo.find({
      where: { id: In(uniqueIds) },
    });
    const sessionById = new Map(sessions.map((session) => [session.id, session]));
    const lockedSessionIds = await this.getLockedSessionIds(
      sessions.map((session) => session.id),
    );

    const skipped: Array<{ id: string; reason: string }> = [];
    const sessionsToDelete: Session[] = [];

    for (const id of uniqueIds) {
      const session = sessionById.get(id);
      if (!session) {
        skipped.push({ id, reason: "Session not found" });
        continue;
      }

      const blockReason = this.getSessionDeletionBlockReason(
        session,
        lockedSessionIds,
      );
      if (blockReason) {
        skipped.push({ id, reason: blockReason });
        continue;
      }

      sessionsToDelete.push(session);
    }

    if (sessionsToDelete.length > 0) {
      const deleteIds = sessionsToDelete.map((session) => session.id);
      await AppDataSource.getRepository(AttendanceRecord).delete({
        sessionId: In(deleteIds),
      });
      await sessionRepo.remove(sessionsToDelete);
    }

    return {
      deleted: sessionsToDelete.length,
      deletedIds: sessionsToDelete.map((session) => session.id),
      skipped,
    };
  }

  /**
   * Deletes a single upcoming/scheduled session.
   * Cleans up attendance records for this session.
   */
  async removeSession(sessionId: string) {
    const result = await this.removeSessions([sessionId]);
    if (result.deleted > 0) {
      return;
    }

    const skipped = result.skipped[0];
    if (skipped?.reason === "Session not found") {
      throw new AppError(404, skipped.reason, "SESSION_NOT_FOUND");
    }

    throw new AppError(
      400,
      skipped?.reason ?? "Session cannot be deleted",
      "SESSION_NOT_DELETABLE",
    );
  }

  private async assertSessionScheduleAvailable(
    session: Session,
    startAt: Date,
    endAt: Date,
    teacherId: string | null,
    classroomId: string | null,
    room: string | null,
  ) {
    const overlap = (otherStart: Date, otherEnd: Date) =>
      startAt.getTime() < otherEnd.getTime() &&
      otherStart.getTime() < endAt.getTime();

    const classSessions = await AppDataSource.getRepository(Session)
      .createQueryBuilder("other")
      .leftJoinAndSelect("other.class", "otherClass")
      .leftJoinAndSelect("otherClass.teacher", "otherClassTeacher")
      .where("other.id <> :sessionId", { sessionId: session.id })
      .andWhere("other.assessmentId IS NULL")
      .andWhere("other.startAt < :endAt", { endAt })
      .andWhere("other.endAt > :startAt", { startAt })
      .getMany();

    for (const other of classSessions) {
      const otherTeacherId =
        other.teacherId ?? other.class?.teacher?.id ?? null;
      const otherClassroomId =
        other.classroomId ?? other.class?.classroomId ?? null;
      const otherRoom = other.room ?? other.class?.room ?? null;
      const resource =
        teacherId && teacherId === otherTeacherId
          ? "teacher"
          : classroomId && classroomId === otherClassroomId
            ? "classroom"
            : room && otherRoom && room.trim() === otherRoom.trim()
              ? "room"
              : null;

      const sameCohort =
        (session.classId &&
          other.classId &&
          session.classId === other.classId) ||
        (session.class?.term?.id &&
          other.class?.term?.id &&
          session.class.term.id === other.class.term.id);

      const isConflict = resource !== null || sameCohort;
      if (!isConflict || !overlap(other.startAt, other.endAt)) continue;

      const subject =
        other.class?.subject || other.class?.name || "another class";
      const field = resource === "teacher" ? "teacherId" : "startTime";
      const message = resource
        ? `${resource[0].toUpperCase()}${resource.slice(1)} is already assigned to ${subject} at this time`
        : `Time overlaps ${subject} at this time`;
      throw new AppError(409, message, "CLASS_SESSION_CONFLICT", {
        field,
        conflictSubject: subject,
        resource: resource ?? "time",
      });
    }

    const assessmentSessions = await AppDataSource.getRepository(Session)
      .createQueryBuilder("other")
      .innerJoinAndSelect("other.assessment", "assessment")
      .where("other.id <> :sessionId", { sessionId: session.id })
      .andWhere("other.assessmentId IS NOT NULL")
      .andWhere("other.startAt < :endAt", { endAt })
      .andWhere("other.endAt > :startAt", { startAt })
      .getMany();

    for (const other of assessmentSessions) {
      const assessment = other.assessment;
      const sameResource =
        (teacherId && teacherId === assessment?.teacherId) ||
        (classroomId && classroomId === assessment?.classroomId) ||
        (room && other.room && room.trim() === other.room.trim()) ||
        (assessment?.classId && assessment.classId === session.classId);
      if (!sameResource) continue;

      throw new AppError(
        409,
        `This session conflicts with assessment "${assessment?.name || "assessment"}"`,
        "ASSESSMENT_SESSION_CONFLICT",
        {
          field:
            teacherId && teacherId === assessment?.teacherId
              ? "teacherId"
              : "time",
          resource: "assessment",
        },
      );
    }
  }

  /**
   * Weekly-slot rows exist only when no calendar sessions have been generated yet.
   * Updates the class template only; does not cascade into live/ended sessions.
   */
  private async updateWeeklySlotClass(
    classId: string,
    input: {
      startAt?: string;
      endAt?: string;
      room?: string | null;
      classroomId?: string | null;
      teacherId?: string | null;
    },
  ) {
    const cls = await this.repo.findById(classId);
    if (!cls) {
      throw new AppError(404, "Class not found", "CLASS_NOT_FOUND");
    }

    const existingSessions = await AppDataSource.getRepository(Session).find({
      where: { classId, assessmentId: IsNull() },
    });
    const hasLocked = existingSessions.some((row) => {
      const status = sessionStatus(row.startAt, row.endAt);
      return status === "LIVE" || status === "ENDED";
    });
    if (hasLocked) {
      throw new AppError(
        400,
        "This class already has live or ended sessions. Edit an upcoming session instead.",
        "SESSION_NOT_EDITABLE",
      );
    }

    const patch: Partial<ClassInput> = {};
    if (input.teacherId !== undefined) patch.teacherId = input.teacherId;
    if (input.classroomId !== undefined) patch.classroomId = input.classroomId;
    else if (input.room !== undefined) patch.room = input.room ?? "";

    if (input.startAt && input.endAt) {
      const start = new Date(input.startAt);
      const end = new Date(input.endAt);
      if (end.getTime() <= start.getTime()) {
        throw new AppError(
          400,
          "Session end time must be after start time",
          "INVALID_SESSION_TIMES",
        );
      }
      const tz = resolveIanaTimeZone(cls.timeZone);
      const datePart = start.toLocaleDateString("en-CA", { timeZone: tz });
      const startClock = start.toLocaleTimeString("en-GB", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const endClock = end.toLocaleTimeString("en-GB", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      patch.dayTime = `${datePart}T${startClock} ${endClock}`;
      patch.timeZone = tz;
    }

    // Update class template without cascading classroom onto locked sessions.
    if (input.classroomId !== undefined) {
      const classroom = await this.resolveClassroom(input.classroomId, {
        required: false,
        requireActive: Boolean(input.classroomId),
      });
      cls.classroomId = classroom?.id ?? null;
      cls.classroom = classroom;
      cls.room = classroom?.name ?? "";
    } else if (input.room !== undefined) {
      cls.room = input.room?.trim() || "";
    }
    if (input.teacherId !== undefined) {
      if (input.teacherId) {
        const teacher = await this.repo.findTeacherById(input.teacherId);
        cls.teacher = teacher;
      } else {
        cls.teacher = null;
      }
    }
    if (patch.dayTime !== undefined) cls.dayTime = patch.dayTime;
    if (patch.timeZone !== undefined) cls.timeZone = patch.timeZone ?? null;

    await this.repo.save(cls);

    // Only sync classroom/room onto upcoming/scheduled sessions for this class.
    if (input.classroomId !== undefined || input.room !== undefined) {
      await this.syncUpcomingSessionRooms(
        classId,
        cls.classroomId,
        cls.room || null,
      );
    }

    const updated = toClassDto(cls);
    const times = parseDayTime(updated.dayTime, updated.timeZone);
    return {
      id: updated.id,
      classId: updated.id,
      startAt: (times?.startAt ?? new Date()).toISOString(),
      endAt: (times?.endAt ?? new Date()).toISOString(),
      room: updated.room || null,
      classroomId: updated.classroomId,
      teacherId: updated.teacher?.id ?? null,
      teacher: updated.teacher
        ? { id: updated.teacher.id, fullName: updated.teacher.fullName }
        : null,
      gracePeriodMinutes: updated.gracePeriodMinutes ?? 25,
      status: times
        ? sessionStatus(times.startAt, times.endAt)
        : ("SCHEDULED" as SessionStatus),
      isWeeklySlot: true,
      class: updated,
    };
  }

  private async freezeTeacherOnLockedSessions(
    classId: string,
    previousTeacher: { id: string; fullName: string } | null,
  ) {
    if (!previousTeacher) return;
    const sessionRepo = AppDataSource.getRepository(Session);
    const rows = await sessionRepo.find({
      where: { classId, assessmentId: IsNull() },
      relations: { teacher: true },
    });
    const now = Date.now();
    for (const row of rows) {
      const status = sessionStatus(row.startAt, row.endAt, now);
      if (status !== "LIVE" && status !== "ENDED") continue;
      // Preserve whatever this occurrence already had; otherwise stamp class teacher.
      if (!row.teacherId) {
        row.teacherId = previousTeacher.id;
        await sessionRepo.save(row);
      }
    }
  }

  private async clearTeacherOverridesOnUpcomingSessions(classId: string) {
    const sessionRepo = AppDataSource.getRepository(Session);
    const rows = await sessionRepo.find({
      where: { classId, assessmentId: IsNull() },
    });
    const now = Date.now();
    for (const row of rows) {
      const status = sessionStatus(row.startAt, row.endAt, now);
      if (status === "UPCOMING" || status === "SCHEDULED") {
        if (row.teacherId) {
          row.teacherId = null;
          row.teacher = null;
          await sessionRepo.save(row);
        }
      }
    }
  }

  private async applySelectiveTeacherToUpcomingSessions(
    classId: string,
    previousTeacher: { id: string; fullName: string } | null,
    newTeacherId: string | null,
    applyToSessionIds: string[],
  ) {
    const applySet = new Set(applyToSessionIds);
    const sessionRepo = AppDataSource.getRepository(Session);
    const rows = await sessionRepo.find({
      where: { classId, assessmentId: IsNull() },
      relations: { teacher: true },
    });
    const now = Date.now();

    for (const row of rows) {
      const status = sessionStatus(row.startAt, row.endAt, now);
      if (status !== "UPCOMING" && status !== "SCHEDULED") continue;

      const effectiveTeacherId = row.teacherId ?? previousTeacher?.id ?? null;

      if (applySet.has(row.id)) {
        // Follow the new class teacher.
        if (row.teacherId) {
          row.teacherId = null;
          row.teacher = null;
          await sessionRepo.save(row);
        }
        continue;
      }

      if (effectiveTeacherId === newTeacherId) continue;

      // Preserve current teacher so the class template change does not affect this row.
      if (effectiveTeacherId && row.teacherId !== effectiveTeacherId) {
        row.teacherId = effectiveTeacherId;
        await sessionRepo.save(row);
      }
    }
  }

  private async syncUpcomingSessionRooms(
    classId: string,
    classroomId: string | null,
    room: string | null,
  ) {
    const sessionRepo = AppDataSource.getRepository(Session);
    const rows = await sessionRepo.find({
      where: { classId, assessmentId: IsNull() },
    });
    const now = Date.now();
    for (const row of rows) {
      if (sessionStatus(row.startAt, row.endAt, now) === "UPCOMING") {
        row.classroomId = classroomId;
        row.room = room;
        await sessionRepo.save(row);
      }
    }
  }
}

export const adminClassesService = new AdminClassesService();
