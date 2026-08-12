import { AppDataSource } from "../../config/data-source.js";
import { In } from "typeorm";
import {
  Session,
  Class,
  ClassStudent,
  User,
  AttendanceRecord,
  AttendanceStatus,
  ScanEvent,
  ScanStatus,
  ScanFlagReason,
} from "../../entities/index.js";

export class AttendanceRepository {
  private readonly sessions = AppDataSource.getRepository(Session);
  private readonly classes = AppDataSource.getRepository(Class);
  private readonly enrolments = AppDataSource.getRepository(ClassStudent);
  private readonly users = AppDataSource.getRepository(User);
  private readonly attendance = AppDataSource.getRepository(AttendanceRecord);
  private readonly scans = AppDataSource.getRepository(ScanEvent);

  // 1. Session Operations
  async findSessionById(id: string): Promise<Session | null> {
    return this.sessions.findOne({ where: { id } });
  }

  async findSessionWithClassById(id: string): Promise<Session | null> {
    return this.sessions.findOne({
      where: { id },
      relations: { class: true },
    });
  }

  async findSessionsByClassIds(classIds: string[]): Promise<Session[]> {
    return this.sessions.find({
      where: { classId: In(classIds) },
      relations: { class: true },
      order: { startAt: "ASC" },
    });
  }

  // 2. Class Operations
  async findClassesByTeacherId(teacherId: string): Promise<Class[]> {
    return this.classes.find({
      where: { teacher: { id: teacherId } },
    });
  }

  // 3. Enrolment Operations
  async findEnrolmentsByClassId(classId: string): Promise<ClassStudent[]> {
    return this.enrolments.find({
      where: { classId },
      relations: { student: true },
    });
  }

  async findEnrolmentsByStudentId(studentId: string): Promise<ClassStudent[]> {
    return this.enrolments.find({
      where: { studentId },
    });
  }

  // 4. Attendance Record Operations
  async findAttendanceRecordsBySessionId(sessionId: string): Promise<AttendanceRecord[]> {
    return this.attendance.find({
      where: { sessionId },
    });
  }

  async findAttendanceRecordsByStudentId(studentId: string): Promise<AttendanceRecord[]> {
    return this.attendance.find({
      where: { studentId },
    });
  }

  async findAttendanceRecord(sessionId: string, studentId: string): Promise<AttendanceRecord | null> {
    return this.attendance.findOne({
      where: { sessionId, studentId },
    });
  }

  async createAttendanceRecord(data: Partial<AttendanceRecord>): Promise<AttendanceRecord> {
    const record = this.attendance.create(data);
    return this.attendance.save(record);
  }

  async saveAttendanceRecord(record: AttendanceRecord): Promise<AttendanceRecord> {
    return this.attendance.save(record);
  }

  async findUnresolvedAbsences(): Promise<AttendanceRecord[]> {
    return this.attendance.find({
      where: { status: AttendanceStatus.ABSENT },
      relations: { student: true, session: { class: true } },
    });
  }

  // 5. Scan Event Operations
  async findPendingScansBySessionId(sessionId: string): Promise<ScanEvent[]> {
    return this.scans.find({
      where: { sessionId, status: ScanStatus.PENDING },
      relations: { student: true },
    });
  }

  async findScanEventById(id: string): Promise<ScanEvent | null> {
    return this.scans.findOne({
      where: { id },
      relations: { student: true, session: { class: true } },
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
      where: { status: ScanStatus.PENDING },
      relations: { student: true, session: { class: true } },
      order: { scannedAt: "DESC" },
    });
  }

  async countTotalScans(): Promise<number> {
    return this.scans.count();
  }
}
