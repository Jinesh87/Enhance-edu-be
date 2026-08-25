import { AppDataSource } from "../../../config/data-source.js";
import { In, MoreThanOrEqual, LessThanOrEqual, Not, IsNull } from "typeorm";
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
          term: { academicYear: true, yearLevel: true },
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

  async findActiveOrFutureSessions(): Promise<Session[]> {
    const now = new Date();
    return this.sessions.find({
      where: {
        endAt: MoreThanOrEqual(now),
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
            startAt: times.startAt,
            endAt: times.endAt,
            room: c.room || null,
            classroomId: c.classroomId || null,
            gracePeriodMinutes: 25,
          }),
        );
      } catch (err) {
        console.error(
          "Failed to parse dayTime during self-healing:",
          c.dayTime,
          err,
        );
      }
    }

    if (sessionsToCreate.length > 0) {
      const savedSessions = await this.sessions.save(sessionsToCreate);
      for (const s of savedSessions) {
        const enrolments = await this.findEnrolmentsByClassId(s.classId);
        for (const enrol of enrolments) {
          const existing = await this.findAttendanceRecord(s.id, enrol.studentId);
          if (!existing) {
            await this.createAttendanceRecord({
              sessionId: s.id,
              studentId: enrol.studentId,
              status: AttendanceStatus.PENDING,
              scannedAt: null,
            });
          }
        }
      }
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
        scannedAt: Not(IsNull()),
      },

      relations: {
        student: true,
        followUpStaff: true,
        session: {
          class: true,
        },
      },
    });
  }

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

  async countStudentsInGraceWindow(now = new Date()): Promise<number> {
    const result = await this.enrolments
      .createQueryBuilder("enrolment")
      .innerJoin(Session, "session", "session.classId = enrolment.classId")
      .where("session.startAt <= :now", { now })
      .andWhere(
        "session.startAt + (session.gracePeriodMinutes * INTERVAL '1 minute') >= :now",
        { now },
      )
      .select("COUNT(DISTINCT enrolment.studentId)", "count")
      .getRawOne<{ count: string }>();

    return Number(result?.count ?? 0);
  }

  async findCorrectionRecords(filters: {
    year?: number;
    yearLevel?: string;
    term?: string;
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<{ rows: AttendanceRecord[]; total: number }> {
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const limit =
      filters.limit && filters.limit > 0 ? Math.min(filters.limit, 50) : 10;

    const qb = this.attendance
      .createQueryBuilder("record")
      .innerJoinAndSelect("record.student", "student")
      .innerJoinAndSelect("record.session", "session")
      .innerJoinAndSelect("session.class", "class")
      .leftJoinAndSelect("class.term", "term")
      .leftJoinAndSelect("term.academicYear", "academicYear")
      .leftJoinAndSelect("term.yearLevel", "yearLevel")
      .leftJoinAndSelect("record.markedByUser", "markedByUser")
      .where("record.status != :pending", {
        pending: AttendanceStatus.PENDING,
      });

    if (filters.year) {
      qb.andWhere("academicYear.year = :year", { year: filters.year });
    }

    if (filters.yearLevel) {
      qb.andWhere("LOWER(yearLevel.name) = LOWER(:yearLevel)", {
        yearLevel: filters.yearLevel,
      });
    }

    if (filters.term) {
      qb.andWhere("LOWER(term.name) = LOWER(:term)", {
        term: filters.term,
      });
    }

    const search = filters.search?.trim();
    if (search) {
      qb.andWhere(
        `(
          student.fullName ILIKE :search
          OR student.preferredName ILIKE :search
          OR class.name ILIKE :search
          OR class.code ILIKE :search
        )`,
        { search: `%${search}%` },
      );
    }

    qb.orderBy("session.startAt", "DESC").addOrderBy("student.fullName", "ASC");

    const [rows, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { rows, total };
  }

  async findAttendanceRecordById(id: string): Promise<AttendanceRecord | null> {
    return this.attendance.findOne({
      where: { id },
      relations: {
        student: true,
        markedByUser: true,
        session: {
          class: {
            term: {
              academicYear: true,
              yearLevel: true,
            },
          },
        },
      },
    });
  }

  async findLatestDeviceSignals(
    pairs: { sessionId: string; studentId: string }[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (pairs.length === 0) return result;

    const sessionIds = [...new Set(pairs.map((pair) => pair.sessionId))];
    const studentIds = [...new Set(pairs.map((pair) => pair.studentId))];

    const scans = await this.scans.find({
      where: {
        sessionId: In(sessionIds),
        studentId: In(studentIds),
      },
      order: { scannedAt: "DESC" },
      select: {
        id: true,
        sessionId: true,
        studentId: true,
        deviceSignal: true,
      },
    });

    for (const scan of scans) {
      const key = `${scan.sessionId}|${scan.studentId}`;
      if (!result.has(key)) {
        result.set(key, scan.deviceSignal);
      }
    }

    return result;
  }
}
