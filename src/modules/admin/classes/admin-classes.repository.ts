import { In, IsNull, Not } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import {
  calendarDateFromDayTime,
  isHolidayForTerm,
} from "../../../common/utils/holidays.js";
import {
  parseDayTime,
  resolveIanaTimeZone,
} from "../../../common/utils/timezone.js";
import { sessionHasStarted, sessionStatus } from "../../../common/utils/session-status.js";
import {
  Class,
  User,
  Term,
  ClassStudent,
  Session,
  AttendanceRecord,
  AttendanceStatus,
  ScanEvent,
  Task,
  Holiday,
} from "../../../entities/index.js";

export type ClassInput = {
  name?: string;
  code: string;
  room?: string | null;
  classroomId?: string | null;
  subject?: string | null;
  lesson?: string | null;
  dayTime?: string | null;
  timeZone?: string | null;
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
        classroom: true,
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
        classroom: true,
      },
    });
  }

  async findTeacherById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  async findTermById(id: string): Promise<Term | null> {
    return this.terms.findOne({
      where: { id },
      relations: { classroom: true },
    });
  }

  async findTermByName(name: string): Promise<Term | null> {
    return this.terms.findOne({ where: { name } });
  }

  async findGraceMinutesByClassIds(
    classIds: string[],
  ): Promise<Map<string, number>> {
    const graceByClassId = new Map<string, number>();
    if (classIds.length === 0) {
      return graceByClassId;
    }

    const sessions = await AppDataSource.getRepository(Session).find({
      where: { classId: In(classIds), assessmentId: IsNull() },
      select: { classId: true, gracePeriodMinutes: true },
    });

    for (const session of sessions) {
      if (!session.classId) continue;
      if (!graceByClassId.has(session.classId)) {
        graceByClassId.set(session.classId, session.gracePeriodMinutes);
      }
    }

    return graceByClassId;
  }

  async findStudentIdsByClassIds(
    classIds: string[],
  ): Promise<Map<string, string[]>> {
    const studentsByClassId = new Map<string, string[]>();
    if (classIds.length === 0) {
      return studentsByClassId;
    }

    const enrolments = await AppDataSource.getRepository(ClassStudent).find({
      where: { classId: In(classIds) },
      select: { classId: true, studentId: true },
    });

    for (const enrolment of enrolments) {
      const existing = studentsByClassId.get(enrolment.classId);
      if (existing) {
        existing.push(enrolment.studentId);
      } else {
        studentsByClassId.set(enrolment.classId, [enrolment.studentId]);
      }
    }

    return studentsByClassId;
  }

  async findEnrolledStudents(classId: string): Promise<
    { id: string; fullName: string }[]
  > {
    const rows = await AppDataSource.getRepository(ClassStudent).find({
      where: { classId },
      relations: { student: true },
      order: { createdAt: "ASC" },
    });
    return rows
      .filter((row) => row.student)
      .map((row) => ({
        id: row.student.id,
        fullName: row.student.fullName,
      }));
  }

  async create(data: Partial<Class>): Promise<Class> {
    return this.classes.create(data);
  }

  async save(cls: Class): Promise<Class> {
    return this.classes.save(cls);
  }

  async updateSessionClassroom(
    classId: string,
    classroomId: string | null,
    room: string | null,
  ): Promise<void> {
    const now = Date.now();
    const sessions = await AppDataSource.getRepository(Session).find({
      where: { classId, assessmentId: IsNull() },
    });
    for (const session of sessions) {
      const start = session.startAt.getTime();
      const end = session.endAt.getTime();
      // Only sync room onto sessions that have not started yet.
      if (Number.isFinite(start) && now < start) {
        session.classroomId = classroomId;
        session.room = room;
        await AppDataSource.getRepository(Session).save(session);
      }
    }
  }

  async remove(cls: Class): Promise<void> {
    await this.classes.remove(cls);
  }

  async findOneSimple(id: string): Promise<Class | null> {
    return this.classes.findOne({ where: { id } });
  }

  async findByClassroomId(classroomId: string): Promise<Class[]> {
    return this.classes.find({
      where: { classroomId },
      relations: {
        term: { academicYear: true, yearLevel: true },
      },
    });
  }

  async bulkReplace(
    termId: string,
    classesToCreate: ClassInput[],
    gracePeriodMinutes?: number,
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
        relations: { teacher: true, term: true },
      });

      const now = new Date();

      const existingClassMap = new Map<string, Class>();
      existingClasses.forEach((c) => existingClassMap.set(c.code, c));

      // Collect existing sessions and protect live/ended ones
      const existingClassIds = existingClasses.map((c) => c.id);
      let existingSessions: Session[] = [];
      const lockedSessionIds = new Set<string>();

      if (existingClassIds.length > 0) {
        existingSessions = await sessionRepo.find({
          where: { classId: In(existingClassIds), assessmentId: IsNull() },
        });

        if (existingSessions.length > 0) {
          const sessionIds = existingSessions.map((s) => s.id);
          const attendanceRecords = await attendanceRepo.find({
            where: {
              sessionId: In(sessionIds),
              status: Not(AttendanceStatus.PENDING),
            },
            select: { sessionId: true },
          });
          const scanEvents = await scanRepo.find({
            where: { sessionId: In(sessionIds) },
            select: { sessionId: true },
          });
          const tasks = await taskRepo.find({
            where: { sessionId: In(sessionIds) },
            select: { sessionId: true },
          });

          attendanceRecords.forEach((r) => lockedSessionIds.add(r.sessionId));
          scanEvents.forEach((r) => lockedSessionIds.add(r.sessionId));
          tasks.forEach((r) => lockedSessionIds.add(r.sessionId));

          const sessionsToRemove: Session[] = [];
          for (const s of existingSessions) {
            if (lockedSessionIds.has(s.id)) {
              continue;
            }
            sessionsToRemove.push(s);
          }

          if (sessionsToRemove.length > 0) {
            const removeIds = sessionsToRemove.map((s) => s.id);
            await attendanceRepo.delete({ sessionId: In(removeIds) });
            await sessionRepo.remove(sessionsToRemove);
          }
        }
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

      const holidayRepo = transactionManager.getRepository(Holiday);
      const holidays = await holidayRepo.find({
        where: [{ kind: "PUBLIC" }, { kind: "TERM", termId }],
      });

      const savedClasses: Class[] = [];

      const getBaseCode = (cCode: string) => {
        const parts = cCode.trim().split("-");
        return parts.length > 1 ? parts.slice(0, -1).join("-") : cCode;
      };

      const getDatePart = (dt: string | null | undefined) => {
        return dt ? dt.split("T")[0] : null;
      };

      for (const input of classesToCreate) {
        const inputDate = calendarDateFromDayTime(input.dayTime);
        if (
          inputDate &&
          isHolidayForTerm(inputDate, termId, holidays)
        ) {
          continue;
        }

        const teacher = input.teacherId
          ? teacherMap.get(input.teacherId) || null
          : null;
        const code = input.code.trim();
        const baseCode = getBaseCode(code);

        let existingClass = existingClassMap.get(code);
        if (!existingClass) {
          existingClass = existingClasses.find(
            (c) => getBaseCode(c.code) === baseCode,
          );
        }
        if (!existingClass) {
          const matchDate = getDatePart(input.dayTime);
          existingClass = existingClasses.find(
            (c) =>
              c.subject?.trim() === input.subject?.trim() &&
              getDatePart(c.dayTime) === matchDate,
          );
        }

        if (existingClass) {
          const previousTeacherId = existingClass.teacher?.id ?? null;
          const nextTeacherId = teacher?.id ?? null;
          if (previousTeacherId && previousTeacherId !== nextTeacherId) {
            const nowMs = now.getTime();
            for (const s of existingSessions) {
              if (s.classId !== existingClass.id) continue;
              if (!sessionHasStarted(s.startAt, nowMs)) continue;
              if (s.teacherId) continue;
              s.teacherId = previousTeacherId;
              await sessionRepo.save(s);
            }
          }

          existingClass.name =
            input.name?.trim() || `${input.subject ?? "Subject"} Class`;
          existingClass.room = (input.room ?? "").trim();
          existingClass.classroomId = input.classroomId ?? null;
          existingClass.subject = input.subject?.trim() || null;
          existingClass.lesson = input.lesson?.trim() || null;
          existingClass.dayTime = input.dayTime?.trim() || null;
          existingClass.timeZone = resolveIanaTimeZone(input.timeZone);
          existingClass.capacity = input.capacity ?? 20;
          existingClass.contentGroup = input.contentGroup?.trim() || null;
          existingClass.termName = input.term?.trim() || "Term 3 2026";
          if (termObj) existingClass.term = termObj;
          existingClass.teacher = teacher;

          const saved = await classRepo.save(existingClass);
          savedClasses.push(saved);
        } else {
          const newEntity = classRepo.create({
            name: input.name?.trim() || `${input.subject ?? "Subject"} Class`,
            code: input.code.trim(),
            room: (input.room ?? "").trim(),
            classroomId: input.classroomId ?? null,
            subject: input.subject?.trim() || null,
            lesson: input.lesson?.trim() || null,
            dayTime: input.dayTime?.trim() || null,
            timeZone: resolveIanaTimeZone(input.timeZone),
            capacity: input.capacity ?? 20,
            contentGroup: input.contentGroup?.trim() || null,
            termName: input.term?.trim() || "Term 3 2026",
            term: termObj,
            teacher,
          });
          const saved = await classRepo.save(newEntity);
          savedClasses.push(saved);
        }
      }

      // Reassign/clean up student enrollments for unused existing classes to allow deletion
      for (const oldClass of existingClasses) {
        if (!savedClasses.some((c) => c.id === oldClass.id)) {
          // Check if this class has any historical/locked sessions we must preserve
          const remainingSessionCount = await sessionRepo.count({
            where: { classId: oldClass.id },
          });

          if (remainingSessionCount > 0) {
            // Keep the class to preserve history
            continue;
          }

          // Find if there is a new class of the same subject on the same date
          const oldDate = getDatePart(oldClass.dayTime);
          const newClass = savedClasses.find(
            (c) =>
              c.subject?.trim() === oldClass.subject?.trim() &&
              getDatePart(c.dayTime) === oldDate,
          );

          const enrollments = await classStudentRepo.find({
            where: { classId: oldClass.id },
          });

          if (newClass) {
            // Reassign students to the new class
            for (const enroll of enrollments) {
              const alreadyEnrolled = await classStudentRepo.findOne({
                where: { classId: newClass.id, studentId: enroll.studentId },
              });
              if (alreadyEnrolled) {
                await classStudentRepo.remove(enroll);
              } else {
                enroll.classId = newClass.id;
                enroll.class = newClass;
                await classStudentRepo.save(enroll);
              }
            }
          } else {
            // No matching class in the new schedule, delete the enrollments for this class
            if (enrollments.length > 0) {
              await classStudentRepo.remove(enrollments);
            }
          }

          // Now that enrollments are cleared and no history exists, we can delete the old class cleanly
          await classRepo.remove(oldClass);
        }
      }

      // Generate upcoming sessions for saved classes
      const sessionsToCreate: Session[] = [];

      const nowMs = now.getTime();
      const remainingSessionKeys = new Set<string>();
      for (const s of existingSessions) {
        if (lockedSessionIds.has(s.id)) {
          remainingSessionKeys.add(`${s.classId}|${s.startAt.getTime()}`);
        }
      }

      for (const c of savedClasses) {
        if (!c.dayTime) continue;
        try {
          const times = parseDayTime(c.dayTime, c.timeZone);
          if (!times) continue;
          const { startAt, endAt } = times;

          const sessionKey = `${c.id}|${startAt.getTime()}`;
          // Only generate occurrences that have not started yet.
          if (
            sessionStatus(startAt, endAt, nowMs) === "UPCOMING" &&
            !remainingSessionKeys.has(sessionKey)
          ) {
            const termGrace =
              typeof gracePeriodMinutes === "number" ? gracePeriodMinutes : 25;
            sessionsToCreate.push(
              sessionRepo.create({
                classId: c.id,
                startAt,
                endAt,
                room: c.room || null,
                classroomId: c.classroomId || null,
                gracePeriodMinutes: termGrace,
              }),
            );
            remainingSessionKeys.add(sessionKey);
          }
        } catch (err) {
          console.error(
            "Failed to parse dayTime for class session:",
            c.dayTime,
            err,
          );
        }
      }

      if (sessionsToCreate.length > 0) {
        const savedSessions = await sessionRepo.save(sessionsToCreate);
        for (const s of savedSessions) {
          if (!s.classId) continue;
          const enrolments = await classStudentRepo.find({
            where: { classId: s.classId },
          });
          for (const enrol of enrolments) {
            const existing = await attendanceRepo.findOne({
              where: { sessionId: s.id, studentId: enrol.studentId },
            });
            if (!existing) {
              await attendanceRepo.save(
                attendanceRepo.create({
                  sessionId: s.id,
                  studentId: enrol.studentId,
                  status: AttendanceStatus.PENDING,
                  scannedAt: null,
                })
              );
            }
          }
        }
      }

      return savedClasses;
    });
  }
}

export const adminClassesRepository = new AdminClassesRepository();
