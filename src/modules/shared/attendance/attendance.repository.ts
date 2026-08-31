import { AppDataSource } from "../../../config/data-source.js";
import {
  In,
  MoreThanOrEqual,
  LessThanOrEqual,
  IsNull,
  type ObjectLiteral,
  type SelectQueryBuilder,
} from "typeorm";
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

export type AttendanceCohortFilters = {
  year: number;
  yearLevel: string;
  term?: string;
};

export class AttendanceRepository {
  private readonly sessions = AppDataSource.getRepository(Session);

  private readonly classes = AppDataSource.getRepository(Class);

  private readonly enrolments = AppDataSource.getRepository(ClassStudent);

  private readonly attendance = AppDataSource.getRepository(AttendanceRecord);

  private readonly scans = AppDataSource.getRepository(ScanEvent);

  private applyCohortScope<Entity extends ObjectLiteral>(
    query: SelectQueryBuilder<Entity>,
    sessionAlias: string,
    prefix: string,
    filters: AttendanceCohortFilters,
  ) {
    const classAlias = `${prefix}_class`;
    const classTermAlias = `${prefix}_class_term`;
    const classYearAlias = `${prefix}_class_year`;
    const classLevelAlias = `${prefix}_class_level`;
    const assessmentAlias = `${prefix}_assessment`;
    const assessmentTermAlias = `${prefix}_assessment_term`;
    const assessmentYearAlias = `${prefix}_assessment_year`;
    const assessmentLevelAlias = `${prefix}_assessment_level`;

    query
      .leftJoin(`${sessionAlias}.class`, classAlias)
      .leftJoin(`${classAlias}.term`, classTermAlias)
      .leftJoin(`${classTermAlias}.academicYear`, classYearAlias)
      .leftJoin(`${classTermAlias}.yearLevel`, classLevelAlias)
      .leftJoin(`${sessionAlias}.assessment`, assessmentAlias)
      .leftJoin(`${assessmentAlias}.term`, assessmentTermAlias)
      .leftJoin(
        `${assessmentTermAlias}.academicYear`,
        assessmentYearAlias,
      )
      .leftJoin(
        `${assessmentTermAlias}.yearLevel`,
        assessmentLevelAlias,
      )
      .andWhere(
        `(
          (${classYearAlias}.year = :scopeYear
            AND LOWER(${classLevelAlias}.name) = LOWER(:scopeYearLevel))
          OR
          (${assessmentYearAlias}.year = :scopeYear
            AND LOWER(${assessmentLevelAlias}.name) = LOWER(:scopeYearLevel))
        )`,
        {
          scopeYear: filters.year,
          scopeYearLevel: filters.yearLevel,
        },
      );

    if (filters.term) {
      query.andWhere(
        `(
          LOWER(${classTermAlias}.name) = LOWER(:scopeTerm)
          OR LOWER(${assessmentTermAlias}.name) = LOWER(:scopeTerm)
        )`,
        { scopeTerm: filters.term },
      );
    }

    return query;
  }

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
        assessment: {
          teacher: true,
          term: { academicYear: true, yearLevel: true },
          students: { student: true },
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
      where: { classId: In(classIds), assessmentId: IsNull() },
      select: { classId: true },
    });
    const classesWithSessions = new Set(
      existingSessions.map((s) => s.classId).filter(Boolean),
    );

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
            assessmentId: null,
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
        if (!s.classId) continue;
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
      assessmentId: IsNull(),
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

  async findUnresolvedAbsences(
    filters: AttendanceCohortFilters,
  ): Promise<AttendanceRecord[]> {
    const query = this.attendance
      .createQueryBuilder("record")
      .innerJoinAndSelect("record.student", "absenceStudent")
      .leftJoinAndSelect("record.followUpStaff", "absenceFollowUpStaff")
      .innerJoinAndSelect("record.session", "absenceSession")
      .leftJoinAndSelect("absenceSession.class", "absenceClass")
      .leftJoinAndSelect("absenceSession.assessment", "absenceAssessment")
      .where("record.status = :absenceStatus", {
        absenceStatus: AttendanceStatus.ABSENT,
      })
      .andWhere("record.scannedAt IS NOT NULL")
      .orderBy("absenceSession.startAt", "DESC");

    return this.applyCohortScope(
      query,
      "absenceSession",
      "absence_scope",
      filters,
    ).getMany();
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

  async findFlaggedScans(
    filters: AttendanceCohortFilters,
  ): Promise<ScanEvent[]> {
    const query = this.scans
      .createQueryBuilder("scan")
      .innerJoinAndSelect("scan.student", "scanStudent")
      .innerJoinAndSelect("scan.session", "scanSession")
      .leftJoinAndSelect("scanSession.class", "scanClass")
      .leftJoinAndSelect("scanSession.assessment", "scanAssessment")
      .where("scan.status = :scanStatus", { scanStatus: ScanStatus.PENDING })
      .orderBy("scan.scannedAt", "DESC");

    return this.applyCohortScope(
      query,
      "scanSession",
      "scan_scope",
      filters,
    ).getMany();
  }

  async countTotalScans(
    since: Date | undefined,
    filters: AttendanceCohortFilters,
  ): Promise<number> {
    const query = this.scans
      .createQueryBuilder("scan")
      .innerJoin("scan.session", "countScanSession");
    if (since) {
      query.where("scan.scannedAt >= :scanSince", { scanSince: since });
    }
    return this.applyCohortScope(
      query,
      "countScanSession",
      "count_scan_scope",
      filters,
    ).getCount();
  }

  async countStudentsInGraceWindow(
    now = new Date(),
    filters: AttendanceCohortFilters,
  ): Promise<number> {
    const query = this.enrolments
      .createQueryBuilder("enrolment")
      .innerJoin(Session, "session", "session.classId = enrolment.classId")
      .where("session.startAt <= :now", { now })
      .andWhere(
        "session.startAt + (session.gracePeriodMinutes * INTERVAL '1 minute') >= :now",
        { now },
      );
    const result = await this.applyCohortScope(
      query,
      "session",
      "grace_scope",
      filters,
    )
      .select("COUNT(DISTINCT enrolment.studentId)", "count")
      .getRawOne<{ count: string }>();

    return Number(result?.count ?? 0);
  }

  async findCorrectionRecords(filters: {
    year: number;
    yearLevel: string;
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
      .leftJoinAndSelect("session.class", "sessionClass")
      .leftJoinAndSelect("sessionClass.term", "sessionClassTerm")
      .leftJoinAndSelect("sessionClassTerm.academicYear", "sessionClassYear")
      .leftJoinAndSelect("sessionClassTerm.yearLevel", "sessionClassLevel")
      .leftJoinAndSelect("session.assessment", "sessionAssessment")
      .leftJoinAndSelect("sessionAssessment.term", "sessionAssessmentTerm")
      .leftJoinAndSelect(
        "sessionAssessmentTerm.academicYear",
        "sessionAssessmentYear",
      )
      .leftJoinAndSelect(
        "sessionAssessmentTerm.yearLevel",
        "sessionAssessmentLevel",
      )
      .leftJoinAndSelect("record.markedByUser", "markedByUser")
      .where("record.status != :pending", {
        pending: AttendanceStatus.PENDING,
      });

    this.applyCohortScope(qb, "session", "correction_scope", filters);

    const search = filters.search?.trim();
    if (search) {
      qb.andWhere(
        `(
          student.fullName ILIKE :search
          OR student.preferredName ILIKE :search
          OR correction_scope_class.name ILIKE :search
          OR correction_scope_class.code ILIKE :search
          OR correction_scope_assessment.name ILIKE :search
          OR correction_scope_assessment.subject ILIKE :search
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
          assessment: {
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
