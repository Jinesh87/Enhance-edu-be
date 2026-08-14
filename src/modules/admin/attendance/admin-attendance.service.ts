import { AttendanceRepository } from "../../shared/attendance/attendance.repository.js";
import {
  AttendanceStatus,
  ScanStatus,
  AdminDecision,
} from "../../../entities/index.js";
import { AppError } from "../../../common/errors/AppError.js";

export class AdminAttendanceService {
  private readonly repo = new AttendanceRepository();

  async getExceptionsAndAbsences() {
    const exceptions = await this.repo.findFlaggedScans();
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const totalScans = await this.repo.countTotalScans(since);
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
        graceClosed: new Date(
          ua.session.startAt.getTime() + ua.session.gracePeriodMinutes * 60000,
        ),
      })),
    };
  }

  async resolveScanException(
    scanEventId: string,
    decision: AdminDecision,
    resolvedByUserId: string,
  ) {
    const scan = await this.repo.findScanEventById(scanEventId);
    if (!scan) {
      throw new AppError(404, "Scan event not found", "SCAN_EVENT_NOT_FOUND");
    }

    if (decision === AdminDecision.REJECT) {
      scan.status = ScanStatus.REJECTED;
    } else if (decision === AdminDecision.IGNORE) {
      scan.status = ScanStatus.IGNORED;
    } else {
      scan.status = ScanStatus.ACCEPTED;
    }
    scan.adminDecision = decision;
    scan.resolvedAt = new Date();
    scan.resolvedByUserId = resolvedByUserId;
    await this.repo.saveScanEvent(scan);

    const record = await this.repo.findAttendanceRecord(
      scan.sessionId,
      scan.studentId,
    );
    if (record) {
      if (decision === AdminDecision.ACCEPT_AS_LATE) {
        record.status = AttendanceStatus.LATE;
        record.scannedAt = scan.scannedAt;
      } else if (decision === AdminDecision.ACCEPT) {
        record.status = AttendanceStatus.PRESENT;
        record.scannedAt = scan.scannedAt;
      } else if (
        decision === AdminDecision.REJECT ||
        decision === AdminDecision.IGNORE
      ) {
        record.status = AttendanceStatus.ABSENT;
      }
      await this.repo.saveAttendanceRecord(record);
    }

    return { success: true, scan };
  }
}

export const adminAttendanceService = new AdminAttendanceService();
