import { AttendanceRepository } from "../../shared/attendance/attendance.repository.js";
import { AppError } from "../../../common/errors/AppError.js";
import { MarkManualRollInput } from "../../shared/attendance/attendance.types.js";
import { generateAttendanceQr } from "../../shared/attendance/attendance-qr.js";
import { UserRole } from "../../../common/constants/roles.js";
import { Session } from "../../../entities/Session.js";
import { syncTrialEnquiryOnAttendance } from "../../shared/attendance/sync-trial-enquiry.js";

export class TeacherAttendanceService {
  private readonly repo = new AttendanceRepository();

  async getAuthorizedSession(
    sessionId: string,
    userId: string,
    role: UserRole,
  ): Promise<Session> {
    const session = await this.repo.findSessionWithClassById(sessionId);

    if (!session) {
      throw new AppError(404, "Session not found", "SESSION_NOT_FOUND");
    }

    if (role !== UserRole.SUPER_ADMIN && session.class.teacher?.id !== userId) {
      throw new AppError(
        403,
        "You are not authorized to manage this session",
        "FORBIDDEN",
      );
    }

    return session;
  }

  async generateSessionQrCode(session: Session) {
    const now = Date.now();

    const gracePeriodMinutes = session.gracePeriodMinutes ?? 25;

    const opensAt = session.startAt.getTime();

    const graceClosesAt = session.startAt.getTime() + gracePeriodMinutes * 60_000;
    const classEndsAt = session.endAt.getTime();

    if (now < opensAt) {
      throw new AppError(
        400,
        "Check-in has not opened yet",
        "CHECK_IN_NOT_OPEN",
      );
    }

    if (now > classEndsAt) {
      throw new AppError(
        400,
        "Attendance grace window has closed",
        "CHECK_IN_CLOSED",
      );
    }

    const qr = generateAttendanceQr(session.id);

    return {
      ...qr,
      graceClosesAt: new Date(graceClosesAt),
      gracePeriodMinutes,
    };
  }

  async markManualRoll(
    session: Session,
    input: Omit<MarkManualRollInput, "sessionId">,
  ) {
    const { studentId, status, reason, markedByUserId } = input;

    if (!reason?.trim()) {
      throw new AppError(
        400,
        "Reason is required for manual attendance",
        "MANUAL_REASON_REQUIRED",
      );
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

    let record = await this.repo.findAttendanceRecord(session.id, studentId);

    if (!record) {
      record = await this.repo.createAttendanceRecord({
        sessionId: session.id,
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

    await syncTrialEnquiryOnAttendance({
      studentUserId: studentId,
      status,
      termId: session.class?.term?.id ?? null,
      actorId: markedByUserId,
    });

    return record;
  }
}

export const teacherAttendanceService = new TeacherAttendanceService();
