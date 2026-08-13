import { AttendanceRepository } from "../../shared/attendance/attendance.repository.js";
import { AppError } from "../../../common/errors/AppError.js";
import { MarkManualRollInput } from "../../shared/attendance/attendance.types.js";
import { generateAttendanceQr } from "../../shared/attendance/attendance-qr.js";

export class TeacherAttendanceService {
  private readonly repo = new AttendanceRepository();

  async getTeacherDashboardData(teacherId: string) {
    const classes = await this.repo.findClassesByTeacherId(teacherId);

    const classIds = classes.map((classItem) => classItem.id);

    if (classIds.length === 0) {
      return {
        classes: [],
        activeSessions: [],
      };
    }

    const sessions = await this.repo.findSessionsByClassIds(classIds);

    return {
      classes: classes.map((classItem) => ({
        id: classItem.id,
        name: classItem.name,
        code: classItem.code,
        room: classItem.room,
      })),

      activeSessions: sessions.map((session) => ({
        id: session.id,
        classId: session.classId,
        className: session.class.name,
        classCode: session.class.code,
        room: session.room ?? session.class.room,
        startAt: session.startAt,
        endAt: session.endAt,
        gracePeriodMinutes: session.gracePeriodMinutes,
      })),
    };
  }

  async generateSessionQrCode(sessionId: string) {
    const session = await this.repo.findSessionById(sessionId);

    if (!session) {
      throw new AppError(404, "Session not found", "SESSION_NOT_FOUND");
    }

    const now = Date.now();

    const gracePeriodMinutes = session.gracePeriodMinutes ?? 25;

    const opensAt = session.startAt.getTime();

    const closesAt = session.startAt.getTime() + gracePeriodMinutes * 60_000;

    if (now < opensAt) {
      throw new AppError(
        400,
        "Check-in has not opened yet",
        "CHECK_IN_NOT_OPEN",
      );
    }

    if (now > closesAt) {
      throw new AppError(
        400,
        "Attendance grace window has closed",
        "CHECK_IN_CLOSED",
      );
    }

    const qr = generateAttendanceQr(sessionId);

    return {
      ...qr,
      graceClosesAt: new Date(closesAt),
      gracePeriodMinutes,
    };
  }

  async markManualRoll(input: MarkManualRollInput) {
    const { sessionId, studentId, status, reason, markedByUserId } = input;

    if (!reason?.trim()) {
      throw new AppError(
        400,
        "Reason is required for manual attendance",
        "MANUAL_REASON_REQUIRED",
      );
    }

    const session = await this.repo.findSessionById(sessionId);

    if (!session) {
      throw new AppError(404, "Session not found", "SESSION_NOT_FOUND");
    }

    const isEnrolled = await this.repo.isStudentEnrolled(
      session.classId,
      studentId,
    );

    if (!isEnrolled) {
      throw new AppError(
        400,
        "Student is not enrolled in this class",
        "STUDENT_NOT_ENROLLED",
      );
    }

    let record = await this.repo.findAttendanceRecord(sessionId, studentId);

    if (!record) {
      record = await this.repo.createAttendanceRecord({
        sessionId,
        studentId,
        status,
        scannedAt: new Date(),
        markedManually: true,
        manualReason: reason.trim(),
        markedByUserId,
      });
    } else {
      record.status = status;
      record.markedManually = true;
      record.manualReason = reason.trim();
      record.markedByUserId = markedByUserId;

      await this.repo.saveAttendanceRecord(record);
    }

    return record;
  }
}

export const teacherAttendanceService = new TeacherAttendanceService();
