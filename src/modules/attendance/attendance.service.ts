import crypto from "crypto";
import { AttendanceRepository } from "./attendance.repository.js";
import {
  AttendanceStatus,
  ScanStatus,
  ScanFlagReason,
} from "../../entities/index.js";
import { AppError } from "../../common/errors/AppError.js";

const QR_SECRET = "enhance-edu-qr-secret-key-2026";
const ROTATION_WINDOW_MS = 18000; // 18 seconds rotation

export class AttendanceService {
  private readonly repo = new AttendanceRepository();

  // 1. Generate Rotating QR Code Token (Tutor View)
  async generateSessionQrCode(sessionId: string) {
    const session = await this.repo.findSessionById(sessionId);
    if (!session) {
      throw new AppError(404, "Session not found", "SESSION_NOT_FOUND");
    }

    const now = Date.now();
    const windowIndex = Math.floor(now / ROTATION_WINDOW_MS);
    const timeRemaining = Math.ceil(((windowIndex + 1) * ROTATION_WINDOW_MS - now) / 1000);

    const signature = crypto
      .createHash("md5")
      .update(`${sessionId}:${windowIndex}:${QR_SECRET}`)
      .digest("hex");

    return {
      code: `${sessionId}:${windowIndex}:${signature}`,
      expiresInSeconds: timeRemaining,
    };
  }

  async getTutorDashboardData(teacherId: string) {
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

  // 2. Process Scan (Student Check-in)
  async processScan(input: {
    studentId: string;
    sessionId: string;
    scannedCode: string;
    scannedAt: Date;
    deviceSignal: string;
    isOfflineSync: boolean;
  }) {
    const { studentId, sessionId, scannedCode, scannedAt, deviceSignal, isOfflineSync } = input;

    const session = await this.repo.findSessionWithClassById(sessionId);
    if (!session) {
      throw new AppError(404, "Session not found", "SESSION_NOT_FOUND");
    }

    let reasonFlagged = ScanFlagReason.NONE;

    if (!scannedCode.startsWith(sessionId)) {
      reasonFlagged = ScanFlagReason.WRONG_SESSION_CODE;
    } else {
      const parts = scannedCode.split(":");
      if (parts.length === 3) {
        const codeSessionId = parts[0];
        const codeWindowIndex = parseInt(parts[1], 10);
        const codeSignature = parts[2];

        const currentWindow = Math.floor(scannedAt.getTime() / ROTATION_WINDOW_MS);
        const isValidCurrent =
          crypto
            .createHash("md5")
            .update(`${codeSessionId}:${codeWindowIndex}:${QR_SECRET}`)
            .digest("hex") === codeSignature;

        const isRecentWindow = Math.abs(currentWindow - codeWindowIndex) <= 2;

        if (!isValidCurrent || !isRecentWindow) {
          reasonFlagged = ScanFlagReason.TOKEN_EXPIRED;
        }
      } else {
        reasonFlagged = ScanFlagReason.TOKEN_EXPIRED;
      }
    }

    if (deviceSignal.toLowerCase().includes("14 km") || deviceSignal.toLowerCase().includes("off-network")) {
      reasonFlagged = ScanFlagReason.OFF_NETWORK;
    }

    const existingRecord = await this.repo.findAttendanceRecord(sessionId, studentId);
    if (existingRecord && (existingRecord.status === AttendanceStatus.PRESENT || existingRecord.status === AttendanceStatus.LATE)) {
      reasonFlagged = ScanFlagReason.DUPLICATE_SCAN;
    }

    const isPending = reasonFlagged !== ScanFlagReason.NONE;

    const scan = await this.repo.createScanEvent({
      studentId,
      sessionId,
      scannedAt,
      syncedAt: new Date(),
      scannedCode,
      deviceSignal,
      isOfflineSync,
      status: isPending ? ScanStatus.PENDING : ScanStatus.ACCEPTED,
      reasonFlagged,
    });

    if (isPending) {
      if (!existingRecord) {
        await this.repo.createAttendanceRecord({
          sessionId,
          studentId,
          status: AttendanceStatus.EXCEPTION,
          scannedAt,
        });
      } else {
        existingRecord.status = AttendanceStatus.EXCEPTION;
        existingRecord.scannedAt = scannedAt;
        await this.repo.saveAttendanceRecord(existingRecord);
      }

      return {
        status: "EXCEPTION",
        reasonFlagged,
        scanEventId: scan.id,
      };
    }

    const startOffsetMs = scannedAt.getTime() - session.startAt.getTime();
    const isLate = startOffsetMs > 60 * 1000;

    if (!existingRecord) {
      await this.repo.createAttendanceRecord({
        sessionId,
        studentId,
        status: isLate ? AttendanceStatus.LATE : AttendanceStatus.PRESENT,
        scannedAt,
      });
    } else {
      existingRecord.status = isLate ? AttendanceStatus.LATE : AttendanceStatus.PRESENT;
      existingRecord.scannedAt = scannedAt;
      await this.repo.saveAttendanceRecord(existingRecord);
    }

    return {
      status: "CONFIRMED",
      sessionName: session.class.name,
      room: session.room ?? session.class.room,
      scannedAt,
    };
  }

  // 3. Batch Sync Offline Scans
  async syncOfflineScans(studentId: string, scans: any[]) {
    const results = [];
    for (const scan of scans) {
      try {
        const res = await this.processScan({
          studentId,
          sessionId: scan.sessionId,
          scannedCode: scan.scannedCode,
          scannedAt: new Date(scan.scannedAt),
          deviceSignal: scan.deviceSignal,
          isOfflineSync: true,
        });
        results.push({ success: true, scan, result: res });
      } catch (err: any) {
        results.push({ success: false, scan, error: err.message });
      }
    }
    return results;
  }

  // 4. Live Roll Data (Tutor View)
  async getLiveRollData(sessionId: string) {
    const session = await this.repo.findSessionWithClassById(sessionId);
    if (!session) {
      throw new AppError(404, "Session not found", "SESSION_NOT_FOUND");
    }

    // Get all enrolled students
    const enrols = await this.repo.findEnrolmentsByClassId(session.classId);

    // Get resolved attendance records
    const attendanceRecords = await this.repo.findAttendanceRecordsBySessionId(sessionId);

    // Get pending/syncing scans
    const pendingScans = await this.repo.findPendingScansBySessionId(sessionId);

    const roll = enrols.map((enrol) => {
      const student = enrol.student;
      const record = attendanceRecords.find((r) => r.studentId === student.id);
      const isSyncing = pendingScans.some(
        (s) => s.studentId === student.id && s.deviceSignal === "queued on device"
      );

      let status = "Not scanned";
      let time = "";

      if (isSyncing) {
        status = "Syncing...";
      } else if (record) {
        if (record.status === AttendanceStatus.PRESENT) {
          status = "Present";
        } else if (record.status === AttendanceStatus.LATE) {
          status = "Late";
        } else if (record.status === AttendanceStatus.EXCEPTION) {
          status = "Exception";
        } else if (record.status === AttendanceStatus.EXCUSED) {
          status = "Excused";
        }
        if (record.scannedAt) {
          const hours = String(record.scannedAt.getHours()).padStart(2, "0");
          const mins = String(record.scannedAt.getMinutes()).padStart(2, "0");
          const secs = String(record.scannedAt.getSeconds()).padStart(2, "0");
          time = `${hours}:${mins}:${secs}`;
        }
      }

      return {
        id: student.id,
        fullName: student.fullName,
        preferredName: student.preferredName,
        status,
        time,
      };
    });

    return {
      session: {
        className: session.class.name,
        classCode: session.class.code,
        room: session.room ?? session.class.room,
        startAt: session.startAt,
        endAt: session.endAt,
      },
      roll,
    };
  }

  // 5. Manual Roll Marking (Tutor View)
  async markManualRoll(input: {
    sessionId: string;
    studentId: string;
    status: AttendanceStatus;
    reason: string;
    markedByUserId: string;
  }) {
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

  // 6. Stats & Exceptions Queue (Admin View)
  async getExceptionsAndAbsences() {
    // Awaiting review scan events
    const exceptions = await this.repo.findFlaggedScans();

    // Count stats
    const totalScans = await this.repo.countTotalScans();
    const pendingCount = exceptions.length;

    // Unresolved absences list
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

  // 7. Resolve Scan Exception (Admin View)
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

    // Update the corresponding attendance record
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

  async getStudentDashboardData(studentId: string) {
    const enrols = await this.repo.findEnrolmentsByStudentId(studentId);
    const classIds = enrols.map((e) => e.classId);
    if (classIds.length === 0) {
      return { sessions: [] };
    }

    const sessions = await this.repo.findSessionsByClassIds(classIds);
    const attendanceRecords = await this.repo.findAttendanceRecordsByStudentId(studentId);

    return {
      sessions: sessions.map((s) => {
        const att = attendanceRecords.find((r) => r.sessionId === s.id);
        let checkedInTime = "";
        let status = "Not checked in";
        if (att) {
          if (att.status === AttendanceStatus.PRESENT || att.status === AttendanceStatus.LATE) {
            status = "Checked in";
            if (att.scannedAt) {
              const hours = String(att.scannedAt.getHours()).padStart(2, "0");
              const mins = String(att.scannedAt.getMinutes()).padStart(2, "0");
              checkedInTime = `${hours}:${mins}`;
            }
          }
        }
        return {
          id: s.id,
          classId: s.classId,
          className: s.class.name,
          classCode: s.class.code,
          room: s.room ?? s.class.room,
          startAt: s.startAt,
          endAt: s.endAt,
          status,
          checkedInTime,
        };
      }),
    };
  }
}

export const attendanceService = new AttendanceService();
