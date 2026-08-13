import crypto from "crypto";
import { AttendanceRepository } from "../../shared/attendance/attendance.repository.js";
import { AppError } from "../../../common/errors/AppError.js";
import { MarkManualRollInput } from "../../shared/attendance/attendance.types.js";

const QR_SECRET = "enhance-edu-qr-secret-key-2026";
const ROTATION_WINDOW_MS = 18000;

export class TeacherAttendanceService {
  private readonly repo = new AttendanceRepository();

  async getTeacherDashboardData(teacherId: string) {
    const classes = await this.repo.findClassesByTeacherId(teacherId);
    const classIds = classes.map((c) => c.id);
    if (classIds.length === 0) {
      return { classes: [], activeSessions: [] };
    }

    const sessions = await this.repo.findSessionsByClassIds(classIds);

    return {
      classes: classes.map((c) => ({
        id: c.id,
        name: c.name,
        code: c.code,
        room: c.room,
      })),
      activeSessions: sessions.map((s) => ({
        id: s.id,
        classId: s.classId,
        className: s.class.name,
        classCode: s.class.code,
        room: s.room ?? s.class.room,
        startAt: s.startAt,
        endAt: s.endAt,
      })),
    };
  }

  async generateSessionQrCode(sessionId: string) {
    const session = await this.repo.findSessionById(sessionId);
    if (!session) {
      throw new AppError(404, "Session not found", "SESSION_NOT_FOUND");
    }

    const now = Date.now();
    const windowIndex = Math.floor(now / ROTATION_WINDOW_MS);
    const timeRemaining = Math.ceil(
      ((windowIndex + 1) * ROTATION_WINDOW_MS - now) / 1000,
    );

    const signature = crypto
      .createHmac("sha256", QR_SECRET)
      .update(`${sessionId}:${windowIndex}`)
      .digest("hex");

    return {
      code: `${sessionId}:${windowIndex}:${signature}`,
      expiresInSeconds: timeRemaining,
    };
  }

  async markManualRoll(input: MarkManualRollInput) {
    const { sessionId, studentId, status, reason, markedByUserId } = input;

    let record = await this.repo.findAttendanceRecord(sessionId, studentId);

    if (!record) {
      record = await this.repo.createAttendanceRecord({
        sessionId,
        studentId,
        status,
        scannedAt: new Date(),
        markedManually: true,
        manualReason: reason,
        markedByUserId,
      });
    } else {
      record.status = status;
      record.markedManually = true;
      record.manualReason = reason;
      record.markedByUserId = markedByUserId;
      await this.repo.saveAttendanceRecord(record);
    }

    return record;
  }
}

export const teacherAttendanceService = new TeacherAttendanceService();
