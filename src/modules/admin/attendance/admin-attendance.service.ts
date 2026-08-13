import { AttendanceRepository } from "../../shared/attendance/attendance.repository.js";
import { AttendanceStatus, ScanStatus } from "../../../entities/index.js";
import { AppError } from "../../../common/errors/AppError.js";

export class AdminAttendanceService {
  private readonly repo = new AttendanceRepository();

  async getExceptionsAndAbsences() {
    const exceptions = await this.repo.findFlaggedScans();
    const totalScans = await this.repo.countTotalScans();
    const pendingCount = exceptions.length;
    const unresolvedAbsences = await this.repo.findUnresolvedAbsences();

    return {
      stats: {
        scannedToday: totalScans,
        inGraceWindow: 11, // Mock count matching S7/S8 screen mockup
        exceptionsCount: pendingCount,
        unresolvedAbsencesCount: unresolvedAbsences.length,
      },
      exceptions: exceptions.map((e) => ({
        id: e.id,
        studentName: e.student.fullName,
        sessionName: `${e.session.class.code} - ${e.session.class.name}`,
        scannedAt: e.scannedAt,
        reasonFlagged: e.reasonFlagged,
        deviceSignal: e.deviceSignal,
      })),
      unresolvedAbsences: unresolvedAbsences.map((ua) => ({
        id: ua.id,
        studentName: ua.student.fullName,
        sessionName: `${ua.session.class.code} - ${ua.session.class.name}`,
        graceClosed: new Date(ua.session.startAt.getTime() + ua.session.gracePeriodMinutes * 60000),
      })),
    };
  }

  async resolveScanException(scanEventId: string, decision: string, resolvedByUserId: string) {
    const scan = await this.repo.findScanEventById(scanEventId);
    if (!scan) {
      throw new AppError(404, "Scan event not found", "SCAN_EVENT_NOT_FOUND");
    }

    scan.status = decision === "Reject" ? ScanStatus.REJECTED : ScanStatus.ACCEPTED;
    scan.adminDecision = decision;
    scan.resolvedAt = new Date();
    scan.resolvedByUserId = resolvedByUserId;
    await this.repo.saveScanEvent(scan);

    const record = await this.repo.findAttendanceRecord(scan.sessionId, scan.studentId);
    if (record) {
      if (decision === "Accept as late" || decision === "Accept") {
        record.status = AttendanceStatus.LATE;
        record.scannedAt = scan.scannedAt;
      } else if (decision === "Reject" || decision === "Ignore") {
        record.status = AttendanceStatus.ABSENT;
      }
      await this.repo.saveAttendanceRecord(record);
    }

    return { success: true, scan };
  }
}

export const adminAttendanceService = new AdminAttendanceService();
