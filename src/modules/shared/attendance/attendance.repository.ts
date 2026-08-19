import { AppDataSource } from "../../../config/data-source.js";
import { In, MoreThanOrEqual, LessThanOrEqual } from "typeorm";
import { parseDayTime } from "../../../common/utils/timezone.js";
import {
  Session,
  Class,
  ClassStudent,
  AttendanceRecord,
  AttendanceStatus,
  ScanEvent,
  ScanStatus,
} from "../../../entities/index.js";

export class AttendanceRepository {
  private readonly sessions = AppDataSource.getRepository(Session);

  private readonly classes = AppDataSource.getRepository(Class);

  private readonly enrolments = AppDataSource.getRepository(ClassStudent);

  private readonly attendance = AppDataSource.getRepository(AttendanceRecord);

  private readonly scans = AppDataSource.getRepository(ScanEvent);

  // Session

  async findSessionById(id: string): Promise<Session | null> {
    return this.sessions.findOne({
      where: { id },
    });
  }

  async findSessionWithClassById(id: string): Promise<Session | null> {
    return this.sessions.findOne({
      where: { id },
      relations: {
        class: {
          teacher: true,
        },
      },
    });
  }

  async findSessionsStartedSince(since: Date): Promise<Session[]> {
    return this.sessions.find({
      where: {
        startAt: MoreThanOrEqual(since),
      },
      relations: {
        class: true,
      },
      order: {
        startAt: "ASC",
      },
    });
  }

  async ensureSessionsExistForClassIds(classIds: string[]): Promise<void> {
    if (classIds.length === 0) return;

    const existingSessions = await this.sessions.find({
      where: { classId: In(classIds) },
      select: { classId: true },
    });
    const classesWithSessions = new Set(existingSessions.map((s) => s.classId));

    const missingClassIds = classIds.filter((id) => !classesWithSessions.has(id));
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
            startAt: times.startAt,
            endAt: times.endAt,
            room: c.room || null,
            gracePeriodMinutes: 25,
          }),
        );
      } catch (err) {
        console.error("Failed to parse dayTime during self-healing:", c.dayTime, err);
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

    const where: any = {
      classId: In(classIds),
    };
    if (since) {
      where.endAt = MoreThanOrEqual(since);
    }
    if (until) {
      where.startAt = LessThanOrEqual(until);
    }
    return this.sessions.find({
      where,
      relations: {
        class: true,
      },
      order: {
        startAt: "ASC",
      },
    });
  }

  // Classes

  async findClassesByTeacherId(teacherId: string): Promise<Class[]> {
    return this.classes.find({
      where: {
        teacher: {
          id: teacherId,
        },
      },
    });
  }

  // Enrolments

  async findEnrolmentsByClassId(classId: string): Promise<ClassStudent[]> {
    return this.enrolments.find({
      where: {
        classId,
      },

      relations: {
        student: true,
      },
    });
  }

  async findEnrolmentsByStudentId(studentId: string): Promise<ClassStudent[]> {
    return this.enrolments.find({
      where: {
        studentId,
      },
    });
  }

  async isStudentEnrolled(
    classId: string,
    studentId: string,
  ): Promise<boolean> {
    const enrolment = await this.enrolments.findOne({
      where: {
        classId,
        studentId,
      },
    });

    return Boolean(enrolment);
  }

  // Attendance records

  async findAttendanceRecordsBySessionId(
    sessionId: string,
  ): Promise<AttendanceRecord[]> {
    return this.attendance.find({
      where: {
        sessionId,
      },
    });
  }

  async findAttendanceRecordsByStudentId(
    studentId: string,
  ): Promise<AttendanceRecord[]> {
    return this.attendance.find({
      where: {
        studentId,
      },
    });
  }

  async findAttendanceRecord(
    sessionId: string,
    studentId: string,
  ): Promise<AttendanceRecord | null> {
    return this.attendance.findOne({
      where: {
        sessionId,
        studentId,
      },
    });
  }

  async createAttendanceRecord(
    data: Partial<AttendanceRecord>,
  ): Promise<AttendanceRecord> {
    const record = this.attendance.create(data);

    return this.attendance.save(record);
  }

  async saveAttendanceRecord(
    record: AttendanceRecord,
  ): Promise<AttendanceRecord> {
    return this.attendance.save(record);
  }

  async findUnresolvedAbsences(): Promise<AttendanceRecord[]> {
    return this.attendance.find({
      where: {
        status: AttendanceStatus.ABSENT,
      },

      relations: {
        student: true,
        session: {
          class: true,
        },
      },
    });
  }

  // Scan events

  async findPendingScansBySessionId(sessionId: string): Promise<ScanEvent[]> {
    return this.scans.find({
      where: {
        sessionId,
        status: ScanStatus.PENDING,
      },

      relations: {
        student: true,
      },
    });
  }

  async findScanEventById(id: string): Promise<ScanEvent | null> {
    return this.scans.findOne({
      where: {
        id,
      },

      relations: {
        student: true,
        session: {
          class: true,
        },
      },
    });
  }

  async createScanEvent(data: Partial<ScanEvent>): Promise<ScanEvent> {
    const scan = this.scans.create(data);

    return this.scans.save(scan);
  }

  async saveScanEvent(scan: ScanEvent): Promise<ScanEvent> {
    return this.scans.save(scan);
  }

  async findFlaggedScans(): Promise<ScanEvent[]> {
    return this.scans.find({
      where: {
        status: ScanStatus.PENDING,
      },

      relations: {
        student: true,
        session: {
          class: true,
        },
      },

      order: {
        scannedAt: "DESC",
      },
    });
  }

  async countTotalScans(since?: Date): Promise<number> {
    const where: any = {};
    if (since) {
      where.scannedAt = MoreThanOrEqual(since);
    }
    return this.scans.count({ where });
  }
}
