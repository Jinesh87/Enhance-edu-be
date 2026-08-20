import { AttendanceRepository } from "../../shared/attendance/attendance.repository.js";
import { AppDataSource } from "../../../config/data-source.js";
import {
  AttendanceStatus,
  ScanStatus,
  AdminDecision,
  ScanEvent,
  AttendanceRecord,
  Session,
  ClassStudent,
} from "../../../entities/index.js";
import { AppError } from "../../../common/errors/AppError.js";

export class AdminAttendanceService {
  private readonly repo = new AttendanceRepository();

  async getExceptionsAndAbsences(filters?: {
    pageExceptions?: number;
    limitExceptions?: number;
    pageAbsences?: number;
    limitAbsences?: number;
  }) {
    const exceptions = await this.repo.findFlaggedScans();

    // Group and unique by student and session to prevent duplicate exception rows
    const seen = new Set<string>();
    const uniqueExceptions = exceptions.filter((e) => {
      const key = `${e.studentId}|${e.sessionId}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const totalScans = await this.repo.countTotalScans(since);
    const pendingCount = uniqueExceptions.length;
    const unresolvedAbsences = await this.repo.findUnresolvedAbsences();

    let mappedExceptions = uniqueExceptions.map((e) => ({
      id: e.id,
      studentName: e.student.fullName,
      sessionName: `${e.session.class.code} - ${e.session.class.name}`,
      scannedAt: e.scannedAt,
      reasonFlagged: e.reasonFlagged,
      deviceSignal: e.deviceSignal,
    }));

    const totalExceptions = mappedExceptions.length;
    if (filters?.pageExceptions && filters?.limitExceptions) {
      const start = (filters.pageExceptions - 1) * filters.limitExceptions;
      mappedExceptions = mappedExceptions.slice(
        start,
        start + filters.limitExceptions,
      );
    }

    let mappedAbsences = unresolvedAbsences.map((ua) => ({
      id: ua.id,
      studentName: ua.student.fullName,
      sessionName: `${ua.session.class.code} - ${ua.session.class.name}`,
      graceClosed: new Date(
        ua.session.startAt.getTime() + ua.session.gracePeriodMinutes * 60000,
      ).toISOString(),
    }));

    const totalAbsences = mappedAbsences.length;
    if (filters?.pageAbsences && filters?.limitAbsences) {
      const start = (filters.pageAbsences - 1) * filters.limitAbsences;
      mappedAbsences = mappedAbsences.slice(
        start,
        start + filters.limitAbsences,
      );
    }

    return {
      stats: {
        scannedToday: totalScans,
        inGraceWindow: 11,
        exceptionsCount: pendingCount,
        unresolvedAbsencesCount: unresolvedAbsences.length,
      },
      exceptions: mappedExceptions,
      totalExceptions,
      unresolvedAbsences: mappedAbsences,
      totalAbsences,
    };
  }

  async resolveScanException(
    scanEventId: string,
    decision: AdminDecision,
    resolvedByUserId: string,
    reassignedSessionId?: string,
  ) {
    return AppDataSource.transaction(async (transactionalEntityManager) => {
      const scansRepo = transactionalEntityManager.getRepository(ScanEvent);
      const attendanceRepo = transactionalEntityManager.getRepository(AttendanceRecord);
      const sessionsRepo = transactionalEntityManager.getRepository(Session);
      const enrollmentsRepo = transactionalEntityManager.getRepository(ClassStudent);

      const scan = await scansRepo.findOne({
        where: { id: scanEventId },
        relations: { student: true, session: { class: true } },
      });

      if (!scan) {
        throw new AppError(404, "Scan event not found", "SCAN_EVENT_NOT_FOUND");
      }

      if (scan.status !== ScanStatus.PENDING) {
        throw new AppError(
          400,
          "Scan event is already resolved",
          "SCAN_EVENT_ALREADY_RESOLVED",
        );
      }

      // Bulk resolve all duplicate pending scans for the same student and session
      const allPendingScans = await scansRepo.find({
        where: {
          sessionId: scan.sessionId,
          status: ScanStatus.PENDING,
        },
      });
      const duplicates = allPendingScans.filter(
        (s) => s.studentId === scan.studentId,
      );

      const statusMap = {
        [AdminDecision.REJECT]: ScanStatus.REJECTED,
        [AdminDecision.IGNORE]: ScanStatus.IGNORED,
        [AdminDecision.ACCEPT]: ScanStatus.ACCEPTED,
        [AdminDecision.ACCEPT_AS_LATE]: ScanStatus.ACCEPTED,
        [AdminDecision.REASSIGN]: ScanStatus.ACCEPTED,
      };
      const targetStatus = statusMap[decision] || ScanStatus.ACCEPTED;

      if (decision === AdminDecision.REASSIGN) {
        if (!reassignedSessionId) {
          throw new AppError(
            400,
            "Reassigned session ID is required",
            "REASSIGN_SESSION_REQUIRED",
          );
        }

        const newSession = await sessionsRepo.findOne({
          where: { id: reassignedSessionId },
        });
        if (!newSession) {
          throw new AppError(
            404,
            "Reassigned session not found",
            "SESSION_NOT_FOUND",
          );
        }

        // Validate student eligibility
        const isEligible = await enrollmentsRepo.findOne({
          where: { classId: newSession.classId, studentId: scan.studentId },
        });
        if (!isEligible) {
          throw new AppError(
            400,
            "Student is not enrolled in the class for the reassigned session",
            "STUDENT_NOT_ELIGIBLE",
          );
        }

        // Prevent duplicate active attendance
        let newRecord = await attendanceRepo.findOne({
          where: { sessionId: reassignedSessionId, studentId: scan.studentId },
        });
        if (newRecord && newRecord.status !== AttendanceStatus.ABSENT) {
          throw new AppError(
            400,
            "Student already has an active attendance record for the reassigned session",
            "DUPLICATE_ATTENDANCE",
          );
        }

        // Calculate PRESENT vs LATE status based on scannedAt
        const isLate =
          scan.scannedAt.getTime() >
          newSession.startAt.getTime() + newSession.gracePeriodMinutes * 60000;
        const targetRecordStatus = isLate
          ? AttendanceStatus.LATE
          : AttendanceStatus.PRESENT;

        if (newRecord) {
          newRecord.status = targetRecordStatus;
          newRecord.scannedAt = scan.scannedAt;
          await attendanceRepo.save(newRecord);
        } else {
          newRecord = attendanceRepo.create({
            sessionId: reassignedSessionId,
            studentId: scan.studentId,
            status: targetRecordStatus,
            scannedAt: scan.scannedAt,
          });
          await attendanceRepo.save(newRecord);
        }

        // Set original session attendance to ABSENT and clear scannedAt
        const originalRecord = await attendanceRepo.findOne({
          where: { sessionId: scan.sessionId, studentId: scan.studentId },
        });
        if (originalRecord) {
          originalRecord.status = AttendanceStatus.ABSENT;
          originalRecord.scannedAt = null; // Clear scannedAt so it doesn't show in Unresolved Absences
          await attendanceRepo.save(originalRecord);
        }
      } else {
        // Standard flow: ACCEPT, ACCEPT_AS_LATE, REJECT, IGNORE
        let record = await attendanceRepo.findOne({
          where: { sessionId: scan.sessionId, studentId: scan.studentId },
        });

        if (record) {
          if (decision === AdminDecision.ACCEPT_AS_LATE) {
            record.status = AttendanceStatus.LATE;
            record.scannedAt = scan.scannedAt;
          } else if (decision === AdminDecision.ACCEPT) {
            record.status = AttendanceStatus.PRESENT;
            record.scannedAt = scan.scannedAt;
          } else if (decision === AdminDecision.REJECT) {
            record.status = AttendanceStatus.ABSENT;
            record.scannedAt = null; // Clear scannedAt so it doesn't show in Unresolved Absences
          } else if (decision === AdminDecision.IGNORE) {
            const gracePeriodMinutes = scan.session.gracePeriodMinutes ?? 25;
            const graceClosesAt = scan.session.startAt.getTime() + gracePeriodMinutes * 60_000;
            const isGraceClosed = Date.now() > graceClosesAt;
            record.status = isGraceClosed ? AttendanceStatus.ABSENT : AttendanceStatus.PENDING;
            record.scannedAt = null; // Clear scannedAt so it doesn't show in Unresolved Absences
          }
          await attendanceRepo.save(record);
        }
      }

      // Save scans
      for (const dup of duplicates) {
        dup.status = targetStatus;
        dup.adminDecision = decision;
        dup.resolvedAt = new Date();
        dup.resolvedByUserId = resolvedByUserId;
        if (decision === AdminDecision.REASSIGN) {
          dup.reassignedSessionId = reassignedSessionId || null;
        }
        await scansRepo.save(dup);
      }

      return { success: true, scan };
    });
  }

  async getEligibleSessionsForException(scanEventId: string) {
    const scan = await this.repo.findScanEventById(scanEventId);
    if (!scan) {
      throw new AppError(404, "Scan event not found", "SCAN_EVENT_NOT_FOUND");
    }

    const studentEnrolments = await this.repo.findEnrolmentsByStudentId(scan.studentId);
    const classIds = studentEnrolments.map((e) => e.classId);
    if (classIds.length === 0) {
      return [];
    }

    const sessions = await this.repo.findSessionsByClassIds(classIds);
    return sessions.map((s) => ({
      id: s.id,
      className: s.class.name,
      classCode: s.class.code,
      startAt: s.startAt.toISOString(),
      room: s.room,
    }));
  }
}

export const adminAttendanceService = new AdminAttendanceService();
