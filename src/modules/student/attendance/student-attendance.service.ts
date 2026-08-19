import { AttendanceRepository } from "../../shared/attendance/attendance.repository.js";
import {
  AttendanceStatus,
  ScanStatus,
  ScanFlagReason,
  InstitutionSetting,
} from "../../../entities/index.js";
import { AppDataSource } from "../../../config/data-source.js";
import { AppError } from "../../../common/errors/AppError.js";
import {
  haversineDistance,
  ROOM_COORDINATES,
} from "../../../common/utils/geo.js";
import {
  OfflineScanInput,
  ProcessScanInput,
} from "../../shared/attendance/attendance.types.js";
import { validateAttendanceQr } from "../../shared/attendance/attendance-qr.js";

export class StudentAttendanceService {
  private readonly repo = new AttendanceRepository();

  async getStudentDashboardData(studentId: string) {
    const enrols = await this.repo.findEnrolmentsByStudentId(studentId);

    const classIds = enrols.map((enrolment) => enrolment.classId);

    if (classIds.length === 0) {
      return {
        sessions: [],
      };
    }

    const since = new Date();
    since.setHours(0, 0, 0, 0);

    const until = new Date();
    until.setHours(23, 59, 59, 999);

    const sessions = await this.repo.findSessionsByClassIds(
      classIds,
      since,
      until,
    );

    const attendanceRecords =
      await this.repo.findAttendanceRecordsByStudentId(studentId);

    return {
      sessions: sessions.map((session) => {
        const attendance = attendanceRecords.find(
          (record) => record.sessionId === session.id,
        );

        let status = "Not checked in";
        let checkedInTime = "";

        if (
          attendance &&
          (attendance.status === AttendanceStatus.PRESENT ||
            attendance.status === AttendanceStatus.LATE)
        ) {
          status = "Checked in";

          if (attendance.scannedAt) {
            const hours = String(attendance.scannedAt.getHours()).padStart(
              2,
              "0",
            );

            const minutes = String(attendance.scannedAt.getMinutes()).padStart(
              2,
              "0",
            );

            checkedInTime = `${hours}:${minutes}`;
          }
        }

        return {
          id: session.id,
          classId: session.classId,
          className: session.class.name,
          classCode: session.class.code,
          room: session.room ?? session.class.room,
          startAt: session.startAt,
          endAt: session.endAt,
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

    if (!sessionId || !scannedCode) {
      throw new AppError(
        400,
        "Session ID and QR code are required",
        "INVALID_SCAN",
      );
    }

    if (Number.isNaN(scannedAt.getTime())) {
      throw new AppError(400, "Invalid scan time", "INVALID_SCAN_TIME");
    }

    const session = await this.repo.findSessionWithClassById(sessionId);

    if (!session) {
      throw new AppError(404, "Session not found", "SESSION_NOT_FOUND");
    }

    const isEnrolled = await this.repo.isStudentEnrolled(
      session.classId,
      studentId,
    );

    if (!isEnrolled) {
      throw new AppError(
        403,
        "You are not enrolled in this class",
        "NOT_ENROLLED",
      );
    }

    const existingRecord = await this.repo.findAttendanceRecord(
      sessionId,
      studentId,
    );

    /*
     * If already successfully checked in,
     * don't modify the valid attendance record.
     */
    if (
      existingRecord &&
      (existingRecord.status === AttendanceStatus.PRESENT ||
        existingRecord.status === AttendanceStatus.LATE)
    ) {
      const duplicateScan = await this.repo.createScanEvent({
        studentId,
        sessionId,
        scannedAt,
        syncedAt: new Date(),
        scannedCode,
        deviceSignal,
        isOfflineSync,
        status: ScanStatus.PENDING,
        reasonFlagged: ScanFlagReason.DUPLICATE_SCAN,
      });

      return {
        status: "ALREADY_CHECKED_IN",
        reasonFlagged: ScanFlagReason.DUPLICATE_SCAN,
        scanEventId: duplicateScan.id,
      };
    }

    let reasonFlagged = ScanFlagReason.NONE;

    /*
     * Check the session attendance window.
     *
     * Example:
     * session starts at 4:00
     * gracePeriodMinutes = 25
     * normal check-in closes at 4:25.
     */
    const gracePeriodMinutes = session.gracePeriodMinutes ?? 25;

    const checkInOpensAt = session.startAt.getTime();

    const checkInClosesAt =
      session.startAt.getTime() + gracePeriodMinutes * 60_000;

    const classEndsAt = session.endAt.getTime();

    const scanTime = scannedAt.getTime();

    const isAfterGracePeriod = scanTime > checkInClosesAt && scanTime <= classEndsAt;

    if (scanTime < checkInOpensAt || scanTime > classEndsAt) {
      reasonFlagged = ScanFlagReason.TOKEN_EXPIRED;
    }

    if (reasonFlagged === ScanFlagReason.NONE && isOfflineSync) {
      const nowTime = Date.now();
      const isFuture = scanTime > nowTime + 60_000;
      const isTooOld = nowTime - scanTime > 24 * 60 * 60 * 1000;
      const syncDelayMs = nowTime - scanTime;
      const isSuspiciousDelay = syncDelayMs > 4 * 60 * 60 * 1000;

      if (isFuture || isTooOld || isSuspiciousDelay) {
        reasonFlagged = ScanFlagReason.SUSPICIOUS_OFFLINE_TIMESTAMP;
      }
    }

    /*
     * Validate QR only when the session window
     * itself hasn't already failed.
     */
    if (reasonFlagged === ScanFlagReason.NONE) {
      const qrResult = validateAttendanceQr(scannedCode, sessionId, scannedAt);

      if (!qrResult.valid) {
        if (qrResult.reason === "WRONG_SESSION_CODE") {
          reasonFlagged = ScanFlagReason.WRONG_SESSION_CODE;
        } else {
          reasonFlagged = ScanFlagReason.TOKEN_EXPIRED;
        }
      }
    }

    /*
     * Location / network validation.
     */
    if (reasonFlagged === ScanFlagReason.NONE) {
      if (latitude !== undefined && longitude !== undefined) {
        const instSetting = await AppDataSource.getRepository(InstitutionSetting).findOneBy({ id: "default" });
        let targetLat: number | null = null;
        let targetLon: number | null = null;

        if (instSetting && instSetting.latitude !== null && instSetting.longitude !== null) {
          targetLat = instSetting.latitude;
          targetLon = instSetting.longitude;
        } else {
          const roomName = session.room ?? session.class.room ?? "Default";
          const roomCoordinates =
            ROOM_COORDINATES[roomName] ?? ROOM_COORDINATES["Default"];
          if (roomCoordinates) {
            targetLat = roomCoordinates.latitude;
            targetLon = roomCoordinates.longitude;
          }
        }

        if (targetLat !== null && targetLon !== null) {
          const distance = haversineDistance(
            latitude,
            longitude,
            targetLat,
            targetLon,
          );

          if (distance > 100) {
            reasonFlagged = ScanFlagReason.OFF_NETWORK;
          }
        }
      } else {
        const signal = deviceSignal?.toLowerCase() ?? "";

        if (signal.includes("14 km") || signal.includes("off-network")) {
          reasonFlagged = ScanFlagReason.OFF_NETWORK;
        }
      }
    }

    const isException = reasonFlagged !== ScanFlagReason.NONE;

    const scanEvent = await this.repo.createScanEvent({
      studentId,
      sessionId,
      scannedAt,

      // This tells us when the backend received it.
      syncedAt: new Date(),

      scannedCode,
      deviceSignal,
      isOfflineSync,

      status: isException ? ScanStatus.PENDING : ScanStatus.ACCEPTED,

      reasonFlagged,
    });

    /*
     * Problematic scan → exception queue.
     */
    if (isException) {
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
        scanEventId: scanEvent.id,
      };
    }

    /*
     * A normal valid scan inside the grace window
     * is PRESENT. If scanned after the grace window but
     * before class ends, mark as ABSENT.
     *
     * LATE is reserved for admin accepting an
     * exception as "Accept as late".
     */
    const status = isAfterGracePeriod ? AttendanceStatus.ABSENT : AttendanceStatus.PRESENT;

    if (!existingRecord) {
      await this.repo.createAttendanceRecord({
        sessionId,
        studentId,
        status,
        scannedAt,
      });
    } else {
      existingRecord.status = status;

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

  async syncOfflineScans(studentId: string, scans: OfflineScanInput[]) {
    const results = [];

    for (const scan of scans) {
      try {
        const scannedAt = new Date(scan.scannedAt);

        if (Number.isNaN(scannedAt.getTime())) {
          results.push({
            success: false,
            scan,
            error: "Invalid scan time",
          });

          continue;
        }

        const result = await this.processScan({
          studentId,
          sessionId: scan.sessionId,
          scannedCode: scan.scannedCode,

          // Offline scans use the original time
          // recorded on the student's device.
          scannedAt,

          deviceSignal: scan.deviceSignal ?? "offline",

          isOfflineSync: true,
          latitude: scan.latitude,
          longitude: scan.longitude,
        });

        results.push({
          success: true,
          scan,
          result,
        });
      } catch (error) {
        results.push({
          success: false,
          scan,
          error:
            error instanceof Error
              ? error.message
              : "Unable to sync attendance",
        });
      }
    }

    return results;
  }
}

export const studentAttendanceService = new StudentAttendanceService();
