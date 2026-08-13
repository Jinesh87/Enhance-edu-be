import crypto from "crypto";
import { AttendanceRepository } from "../../shared/attendance/attendance.repository.js";
import {
  AttendanceStatus,
  ScanStatus,
  ScanFlagReason,
} from "../../../entities/index.js";
import { AppError } from "../../../common/errors/AppError.js";
import {
  haversineDistance,
  ROOM_COORDINATES,
} from "../../../common/utils/geo.js";
import { ProcessScanInput } from "../../shared/attendance/attendance.types.js";

const QR_SECRET = "enhance-edu-qr-secret-key-2026";
const ROTATION_WINDOW_MS = 18000;

export class StudentAttendanceService {
  private readonly repo = new AttendanceRepository();

  async getStudentDashboardData(studentId: string) {
    const enrols = await this.repo.findEnrolmentsByStudentId(studentId);
    const classIds = enrols.map((e) => e.classId);
    if (classIds.length === 0) {
      return { sessions: [] };
    }

    const sessions = await this.repo.findSessionsByClassIds(classIds);
    const attendanceRecords =
      await this.repo.findAttendanceRecordsByStudentId(studentId);

    return {
      sessions: sessions.map((s) => {
        const att = attendanceRecords.find((r) => r.sessionId === s.id);
        let checkedInTime = "";
        let status = "Not checked in";
        if (att) {
          if (
            att.status === AttendanceStatus.PRESENT ||
            att.status === AttendanceStatus.LATE
          ) {
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

  async processScan(input: ProcessScanInput) {
    const {
      studentId,
      sessionId,
      scannedCode,
      scannedAt,
      deviceSignal,
      isOfflineSync,
      latitude,
      longitude,
    } = input;

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

        const currentWindow = Math.floor(
          scannedAt.getTime() / ROTATION_WINDOW_MS,
        );
        const isValidCurrent =
          crypto
            .createHmac("sha256", QR_SECRET)
            .update(`${codeSessionId}:${codeWindowIndex}`)
            .digest("hex") === codeSignature;

        const isRecentWindow = Math.abs(currentWindow - codeWindowIndex) <= 2;

        if (!isValidCurrent || !isRecentWindow) {
          reasonFlagged = ScanFlagReason.TOKEN_EXPIRED;
        }
      } else {
        reasonFlagged = ScanFlagReason.TOKEN_EXPIRED;
      }
    }

    if (latitude !== undefined && longitude !== undefined) {
      const roomName = session.room || "Default";
      const roomCoord =
        ROOM_COORDINATES[roomName] || ROOM_COORDINATES["Default"];
      const distance = haversineDistance(
        latitude,
        longitude,
        roomCoord.latitude,
        roomCoord.longitude,
      );

      if (distance > 100) {
        reasonFlagged = ScanFlagReason.OFF_NETWORK;
      }
    } else {
      if (
        deviceSignal.toLowerCase().includes("14 km") ||
        deviceSignal.toLowerCase().includes("off-network")
      ) {
        reasonFlagged = ScanFlagReason.OFF_NETWORK;
      }
    }

    const existingRecord = await this.repo.findAttendanceRecord(
      sessionId,
      studentId,
    );
    if (
      existingRecord &&
      (existingRecord.status === AttendanceStatus.PRESENT ||
        existingRecord.status === AttendanceStatus.LATE)
    ) {
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
      existingRecord.status = isLate
        ? AttendanceStatus.LATE
        : AttendanceStatus.PRESENT;
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
          latitude: scan.latitude,
          longitude: scan.longitude,
        });
        results.push({ success: true, scan, result: res });
      } catch (err: any) {
        results.push({ success: false, scan, error: err.message });
      }
    }
    return results;
  }
}

export const studentAttendanceService = new StudentAttendanceService();
