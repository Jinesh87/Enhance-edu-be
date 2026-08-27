import { AttendanceRepository } from "../../shared/attendance/attendance.repository.js";
import {
  AttendanceRecord,
  AttendanceStatus,
  ScanStatus,
  ScanFlagReason,
  InstitutionSetting,
  AssessmentStudent,
} from "../../../entities/index.js";

type ScanOutcomeStatus =
  | "CONFIRMED"
  | "EXCEPTION"
  | "GRACE_CLOSED"
  | "ALREADY_CHECKED_IN";

function alreadySubmittedOutcome(record: AttendanceRecord | null): {
  status: ScanOutcomeStatus;
  previousOutcome: "CONFIRMED" | "EXCEPTION" | "GRACE_CLOSED";
  scannedAt?: Date | null;
} | null {
  if (!record) return null;

  if (
    record.status === AttendanceStatus.PRESENT ||
    record.status === AttendanceStatus.LATE ||
    record.status === AttendanceStatus.EXCUSED
  ) {
    return {
      status: "ALREADY_CHECKED_IN",
      previousOutcome: "CONFIRMED",
      scannedAt: record.scannedAt,
    };
  }

  if (record.status === AttendanceStatus.EXCEPTION) {
    return {
      status: "ALREADY_CHECKED_IN",
      previousOutcome: "EXCEPTION",
      scannedAt: record.scannedAt,
    };
  }

  if (record.status === AttendanceStatus.ABSENT && record.scannedAt) {
    return {
      status: "ALREADY_CHECKED_IN",
      previousOutcome: "GRACE_CLOSED",
      scannedAt: record.scannedAt,
    };
  }

  return null;
}
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
import { syncTrialEnquiryOnAttendance } from "../../shared/attendance/sync-trial-enquiry.js";

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
          className: session.class?.name ?? session.assessment?.name ?? "Class",
          classCode: session.class?.code ?? (session.assessmentId ? "EXAM" : ""),
          room: session.room ?? session.class?.room ?? null,
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

    const targetSessionId = sessionId;
    console.log(`[CHECK-IN DEBUG] scannedCode: "${scannedCode}", targetSessionId: "${targetSessionId}"`);

    const session = await this.repo.findSessionWithClassById(targetSessionId);

    if (!session) {
      throw new AppError(404, "Session not found", "SESSION_NOT_FOUND");
    }

    const isEnrolled = session.assessmentId
      ? Boolean(
          await AppDataSource.getRepository(AssessmentStudent).findOne({
            where: {
              assessmentId: session.assessmentId,
              studentId,
            },
          }),
        )
      : session.classId
        ? await this.repo.isStudentEnrolled(session.classId, studentId)
        : false;

    if (!isEnrolled) {
      throw new AppError(
        403,
        session.assessmentId
          ? "You are not on this assessment roll"
          : "You are not enrolled in this class",
        "NOT_ENROLLED",
      );
    }

    const existingRecord = await this.repo.findAttendanceRecord(
      targetSessionId,
      studentId,
    );

    const alreadySubmitted = alreadySubmittedOutcome(existingRecord);
    if (alreadySubmitted) {
      return alreadySubmitted;
    }

    const qrResult = validateAttendanceQr(scannedCode, targetSessionId, scannedAt);

    let reasonFlagged: ScanFlagReason = ScanFlagReason.NONE;
    if (!qrResult.valid) {
      reasonFlagged = qrResult.reason === "WRONG_SESSION_CODE"
        ? ScanFlagReason.WRONG_SESSION_CODE
        : ScanFlagReason.TOKEN_EXPIRED;
    }

    if (reasonFlagged === ScanFlagReason.WRONG_SESSION_CODE) {
      const scanEvent = await this.repo.createScanEvent({
        studentId,
        sessionId: targetSessionId,
        scannedAt,
        syncedAt: new Date(),
        scannedCode,
        deviceSignal,
        isOfflineSync,
        status: ScanStatus.PENDING,
        reasonFlagged,
      });

      return {
        status: "EXCEPTION",
        reasonFlagged,
        scanEventId: scanEvent.id,
      };
    }

    const gracePeriodMinutes = session.gracePeriodMinutes ?? 25;

    const checkInClosesAt =
      session.startAt.getTime() + gracePeriodMinutes * 60_000;

    const scanTime = scannedAt.getTime();

    const isAfterGracePeriod = scanTime > checkInClosesAt;

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

    if (reasonFlagged === ScanFlagReason.NONE) {
      if (latitude !== undefined && longitude !== undefined) {
        const instSetting = await AppDataSource.getRepository(
          InstitutionSetting,
        ).findOneBy({ id: "default" });
        let targetLat: number | null = null;
        let targetLon: number | null = null;

        if (
          instSetting &&
          instSetting.latitude !== null &&
          instSetting.longitude !== null
        ) {
          targetLat = instSetting.latitude;
          targetLon = instSetting.longitude;
        } else {
          const roomName =
            session.room ?? session.class?.room ?? "Default";
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

    const currentReason = reasonFlagged as ScanFlagReason;
    const isHardFailure =
      currentReason === ScanFlagReason.DUPLICATE_SCAN;

    const isException = reasonFlagged !== ScanFlagReason.NONE && !isHardFailure;

    if (isException) {
      const existingPendingScans =
        await this.repo.findPendingScansBySessionId(targetSessionId);
      const studentPendingScans = existingPendingScans.filter(
        (s) => s.studentId === studentId,
      );

      for (const oldScan of studentPendingScans) {
        oldScan.status = ScanStatus.IGNORED;
        await this.repo.saveScanEvent(oldScan);
      }
    }

    const scanEvent = await this.repo.createScanEvent({
      studentId,
      sessionId: targetSessionId,
      scannedAt,

      syncedAt: new Date(),

      scannedCode,
      deviceSignal,
      isOfflineSync,

      status: isException ? ScanStatus.PENDING : (isHardFailure ? ScanStatus.REJECTED : ScanStatus.ACCEPTED),

      reasonFlagged,
    });

    if (isHardFailure) {
      return {
        status: "EXCEPTION",
        reasonFlagged,
        scanEventId: scanEvent.id,
      };
    }

    if (isException) {
      try {
        if (!existingRecord) {
          await this.repo.createAttendanceRecord({
            sessionId: targetSessionId,
            studentId,
            status: AttendanceStatus.EXCEPTION,
            scannedAt,
          });
        } else {
          existingRecord.status = AttendanceStatus.EXCEPTION;

          existingRecord.scannedAt = scannedAt;

          await this.repo.saveAttendanceRecord(existingRecord);
        }
      } catch (err: any) {
        if (
          err &&
          (err.code === "23505" ||
            err.message?.includes("unique constraint") ||
            err.message?.includes("UniqueConstraintError"))
        ) {
          const concurrentRecord = await this.repo.findAttendanceRecord(
            targetSessionId,
            studentId,
          );
          if (concurrentRecord) {
            concurrentRecord.status = AttendanceStatus.EXCEPTION;
            concurrentRecord.scannedAt = scannedAt;
            await this.repo.saveAttendanceRecord(concurrentRecord);
          }
        } else {
          throw err;
        }
      }

      return {
        status: "EXCEPTION",
        reasonFlagged,
        scanEventId: scanEvent.id,
      };
    }

    const status = isAfterGracePeriod
      ? AttendanceStatus.ABSENT
      : AttendanceStatus.PRESENT;

    try {
      if (!existingRecord) {
        await this.repo.createAttendanceRecord({
          sessionId: targetSessionId,
          studentId,
          status,
          scannedAt,
        });
      } else {
        existingRecord.status = status;

        existingRecord.scannedAt = scannedAt;

        await this.repo.saveAttendanceRecord(existingRecord);
      }
    } catch (err: any) {
      if (
        err &&
        (err.code === "23505" ||
          err.message?.includes("unique constraint") ||
          err.message?.includes("UniqueConstraintError"))
      ) {
        const concurrentRecord = await this.repo.findAttendanceRecord(
          sessionId,
          studentId,
        );
        if (concurrentRecord) {
          concurrentRecord.status = status;
          concurrentRecord.scannedAt = scannedAt;
          await this.repo.saveAttendanceRecord(concurrentRecord);
        }
      } else {
        throw err;
      }
    }

    await syncTrialEnquiryOnAttendance({
      studentUserId: studentId,
      status,
      termId: session.class?.term?.id ?? null,
    });

    return {
      status: isAfterGracePeriod ? "GRACE_CLOSED" : "CONFIRMED",
      sessionName:
        session.class?.name ?? session.assessment?.name ?? "Session",
      room: session.room ?? session.class?.room ?? null,
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
