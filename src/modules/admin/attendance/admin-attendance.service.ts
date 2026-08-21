import { AttendanceRepository } from "../../shared/attendance/attendance.repository.js";
import { AppDataSource } from "../../../config/data-source.js";
import {
  AttendanceStatus,
  ScanStatus,
  ScanFlagReason,
  AdminDecision,
  ScanEvent,
  AttendanceRecord,
  Session,
  ClassStudent,
  Student,
  Enrollment,
  Task,
  TaskStatus,
  TaskType,
  User,
  AuditChange,
} from "../../../entities/index.js";
import { AppError } from "../../../common/errors/AppError.js";
import { UserRole } from "../../../common/constants/roles.js";
import { emailService } from "../../email/email.service.js";
import { writeAuditLog } from "../../../common/utils/audit-log.js";

export const ABSENCE_POLICIES = [
  "TASK_AND_ALERT",
  "TASK_ONLY",
  "ALERT_ONLY",
] as const;

export type AbsencePolicy = (typeof ABSENCE_POLICIES)[number];

function policyIncludesTask(policy: string | null) {
  return policy === "TASK_AND_ALERT" || policy === "TASK_ONLY";
}

function policyIncludesAlert(policy: string | null) {
  return policy === "TASK_AND_ALERT" || policy === "ALERT_ONLY";
}

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
    const [totalScans, inGraceWindow, unresolvedAbsences] = await Promise.all([
      this.repo.countTotalScans(since),
      this.repo.countStudentsInGraceWindow(),
      this.repo.findUnresolvedAbsences(),
    ]);
    const pendingCount = uniqueExceptions.length;

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
      policy: ua.absencePolicy,
      followUpStaffId: ua.followUpStaffId,
      followUpStaffName: ua.followUpStaff?.fullName ?? null,
      parentAlertStatus: ua.parentAlertStatus,
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
        inGraceWindow,
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
        (s) =>
          s.studentId === scan.studentId &&
          s.reasonFlagged === scan.reasonFlagged,
      );

      const statusMap = {
        [AdminDecision.REJECT]: ScanStatus.REJECTED,
        [AdminDecision.IGNORE]: ScanStatus.IGNORED,
        [AdminDecision.ACCEPT]: ScanStatus.ACCEPTED,
        [AdminDecision.ACCEPT_AS_LATE]: ScanStatus.ACCEPTED,
        [AdminDecision.REASSIGN]: ScanStatus.ACCEPTED,
      };
      const targetStatus = statusMap[decision] || ScanStatus.ACCEPTED;

      if (decision === AdminDecision.IGNORE && scan.reasonFlagged === ScanFlagReason.WRONG_SESSION_CODE) {
        for (const dup of duplicates) {
          dup.status = ScanStatus.IGNORED;
          dup.adminDecision = decision;
          dup.resolvedAt = new Date();
          dup.resolvedByUserId = resolvedByUserId;
          await scansRepo.save(dup);
        }
        return { success: true, scan };
      }

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

  async updateAbsenceFollowUp(
    attendanceId: string,
    input: { policy?: string | null; followUpStaffId?: string | null },
  ) {
    const record = await this.requireUnresolvedAbsence(attendanceId);

    if (record.parentAlertStatus) {
      throw new AppError(
        400,
        "This absence has already been reviewed",
        "ABSENCE_ALREADY_REVIEWED",
      );
    }

    if (input.policy !== undefined) {
      if (input.policy && !ABSENCE_POLICIES.includes(input.policy as AbsencePolicy)) {
        throw new AppError(400, "Invalid absence policy", "INVALID_POLICY");
      }
      record.absencePolicy = input.policy || null;
      if (!policyIncludesTask(record.absencePolicy)) {
        record.followUpStaffId = null;
        record.followUpStaff = null;
      }
    }

    if (input.followUpStaffId !== undefined) {
      if (!input.followUpStaffId) {
        record.followUpStaffId = null;
        record.followUpStaff = null;
      } else {
        const staff = await AppDataSource.getRepository(User).findOne({
          where: { id: input.followUpStaffId },
        });
        if (
          !staff ||
          (staff.role !== UserRole.STAFF &&
            staff.role !== UserRole.OFFICE_STAFF &&
            staff.role !== UserRole.SUPER_ADMIN)
        ) {
          throw new AppError(400, "Staff member not found", "STAFF_NOT_FOUND");
        }
        record.followUpStaffId = staff.id;
        record.followUpStaff = staff;
      }
    }

    await AppDataSource.getRepository(AttendanceRecord).save(record);
    return this.toAbsenceDto(record);
  }

  async getAbsenceReviewDraft(attendanceId: string) {
    const record = await this.requireUnresolvedAbsence(attendanceId);
    const guardians = await this.findGuardiansForStudentUser(record.studentId);
    const sessionName = `${record.session.class.code} — ${record.session.class.name}`;
    const graceClosed = new Date(
      record.session.startAt.getTime() +
        record.session.gracePeriodMinutes * 60_000,
    );
    const studentName =
      record.student.preferredName || record.student.fullName;
    const guardianName = guardians[0]?.fullName || "there";
    const sessionWhen = graceClosed.toLocaleString("en-AU", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    });

    const draftMessage =
      `${studentName} was not marked present for ${sessionName} after the check-in window closed (${sessionWhen}).\n\n` +
      `Please contact the office if this was unexpected or if you believe this is a mistake.`;

    return {
      id: record.id,
      studentName: record.student.fullName,
      sessionName,
      policy: record.absencePolicy,
      followUpStaffName: record.followUpStaff?.fullName ?? null,
      parentAlertStatus: record.parentAlertStatus,
      guardians,
      draftMessage,
      includesAlert: policyIncludesAlert(record.absencePolicy),
      includesTask: policyIncludesTask(record.absencePolicy),
    };
  }

  async reviewAndSendAbsence(
    attendanceId: string,
    message: string,
    actorId: string,
  ) {
    const record = await this.requireUnresolvedAbsence(attendanceId);

    if (record.parentAlertStatus) {
      throw new AppError(
        400,
        "This absence has already been reviewed",
        "ABSENCE_ALREADY_REVIEWED",
      );
    }

    if (!record.absencePolicy) {
      throw new AppError(
        400,
        "Choose a policy before reviewing",
        "POLICY_REQUIRED",
      );
    }

    const includesTask = policyIncludesTask(record.absencePolicy);
    const includesAlert = policyIncludesAlert(record.absencePolicy);

    if (includesTask && !record.followUpStaffId) {
      throw new AppError(
        400,
        "Assign a staff member before sending a task",
        "STAFF_REQUIRED",
      );
    }

    const sessionName = `${record.session.class.code} — ${record.session.class.name}`;
    const sessionWhen = new Date(
      record.session.startAt.getTime() +
        record.session.gracePeriodMinutes * 60_000,
    ).toLocaleString("en-AU", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    });

    if (includesAlert) {
      const guardians = await this.findGuardiansForStudentUser(record.studentId);
      const withEmail = guardians.filter((g) => g.email);
      if (withEmail.length === 0) {
        throw new AppError(
          400,
          "No guardian email is on file for this student",
          "GUARDIAN_EMAIL_MISSING",
        );
      }

      const body = message.trim();
      if (!body) {
        throw new AppError(400, "Message is required", "MESSAGE_REQUIRED");
      }

      for (const guardian of withEmail) {
        await emailService.sendAbsenceAlertEmail({
          to: guardian.email!,
          guardianName: guardian.fullName,
          studentFullName: record.student.fullName,
          sessionName,
          sessionWhen,
          message: body,
        });
      }
      record.parentAlertSentAt = new Date();
    }

    if (includesTask) {
      await this.assignAbsenceChaseTask(record, actorId);
    }

    record.parentAlertStatus = includesTask && includesAlert
      ? "SENT_AND_ASSIGNED"
      : includesTask
        ? "ASSIGNED"
        : "SENT";

    await AppDataSource.getRepository(AttendanceRecord).save(record);
    return this.toAbsenceDto(record);
  }

  private async assignAbsenceChaseTask(
    record: AttendanceRecord,
    _actorId: string,
  ) {
    const tasks = AppDataSource.getRepository(Task);
    let task = await tasks.findOne({
      where: {
        type: TaskType.ABSENCE_CHASE,
        sessionId: record.sessionId,
        studentId: record.studentId,
      },
    });

    const studentName =
      record.student.preferredName || record.student.fullName;
    const classLabel = record.session.class?.code ?? "class";

    if (!task) {
      task = tasks.create({
        type: TaskType.ABSENCE_CHASE,
        status: TaskStatus.OPEN,
        assignedRole: UserRole.STAFF,
        title: `Chase absence — ${studentName} · ${classLabel}`,
        studentId: record.studentId,
        sessionId: record.sessionId,
        attendanceRecordId: record.id,
        dueAt: record.session.endAt,
        assignedUserId: record.followUpStaffId,
      });
    } else {
      task.assignedUserId = record.followUpStaffId;
      task.assignedRole = UserRole.STAFF;
      task.status = TaskStatus.OPEN;
      task.attendanceRecordId = record.id;
    }

    await tasks.save(task);
  }

  private toAbsenceDto(record: AttendanceRecord) {
    return {
      id: record.id,
      studentName: record.student.fullName,
      sessionName: `${record.session.class.code} - ${record.session.class.name}`,
      graceClosed: new Date(
        record.session.startAt.getTime() +
          record.session.gracePeriodMinutes * 60000,
      ).toISOString(),
      policy: record.absencePolicy,
      followUpStaffId: record.followUpStaffId,
      followUpStaffName: record.followUpStaff?.fullName ?? null,
      parentAlertStatus: record.parentAlertStatus,
    };
  }

  private async requireUnresolvedAbsence(id: string) {
    const record = await AppDataSource.getRepository(AttendanceRecord).findOne({
      where: { id },
      relations: {
        student: true,
        followUpStaff: true,
        session: { class: true },
      },
    });

    if (
      !record ||
      record.status !== AttendanceStatus.ABSENT ||
      !record.scannedAt
    ) {
      throw new AppError(404, "Unresolved absence not found", "ABSENCE_NOT_FOUND");
    }

    return record;
  }

  private async findGuardiansForStudentUser(studentUserId: string) {
    const studentRepo = AppDataSource.getRepository(Student);
    const profile = await studentRepo.findOne({
      where: { userId: studentUserId },
      relations: { guardianLinks: { guardian: true } },
    });

    const byEmail = new Map<string, { fullName: string; email: string | null }>();

    const addGuardian = (fullName: string, email: string | null) => {
      const key = (email || fullName).toLowerCase();
      if (!byEmail.has(key)) {
        byEmail.set(key, { fullName, email });
      }
    };

    if (profile) {
      for (const link of profile.guardianLinks ?? []) {
        if (link.guardian) {
          addGuardian(link.guardian.fullName, link.guardian.email);
        }
      }

      const enrollments = await AppDataSource.getRepository(Enrollment).find({
        where: { studentId: profile.id },
        relations: { guardian: true },
      });
      for (const enrollment of enrollments) {
        if (enrollment.guardian) {
          addGuardian(enrollment.guardian.fullName, enrollment.guardian.email);
        }
      }
    }

    return Array.from(byEmail.values());
  }

  async listRecordsForCorrection(filters: {
    year?: number;
    yearLevel?: string;
    term?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const { rows, total } = await this.repo.findCorrectionRecords(filters);

    const deviceSignals = await this.repo.findLatestDeviceSignals(
      rows.map((row) => ({
        sessionId: row.sessionId,
        studentId: row.studentId,
      })),
    );

    return {
      records: rows.map((row) =>
        this.toCorrectionRow(
          row,
          deviceSignals.get(`${row.sessionId}|${row.studentId}`) ?? null,
        ),
      ),
      total,
    };
  }

  async correctAttendanceRecord(
    id: string,
    status: AttendanceStatus,
    reason: string,
    markedByUserId: string,
  ) {
    if (!reason.trim()) {
      throw new AppError(
        400,
        "A reason is required",
        "MANUAL_REASON_REQUIRED",
      );
    }

    const allowed = new Set<AttendanceStatus>([
      AttendanceStatus.PRESENT,
      AttendanceStatus.LATE,
      AttendanceStatus.ABSENT,
      AttendanceStatus.EXCUSED,
    ]);

    if (!allowed.has(status)) {
      throw new AppError(400, "Invalid attendance status", "INVALID_STATUS");
    }

    const record = await this.repo.findAttendanceRecordById(id);
    if (!record) {
      throw new AppError(404, "Attendance record not found", "NOT_FOUND");
    }

    const previousStatus = record.status;
    record.status = status;
    record.markedManually = true;
    record.manualReason = reason.trim();
    record.markedByUserId = markedByUserId;
    await this.repo.saveAttendanceRecord(record);

    const studentName = record.student?.fullName ?? "Student";
    const className = record.session?.class
      ? `${record.session.class.code} ${record.session.class.name}`.trim()
      : "session";

    await writeAuditLog({
      actorUserId: markedByUserId,
      action: "EDITED",
      recordType: "attendance",
      recordId: record.id,
      recordLabel: `${studentName} · ${className}`,
      recordPath: "/admin/attendance/correct",
      before: { status: previousStatus },
      after: { status, reason: reason.trim() },
    });

    const saved = await this.repo.findAttendanceRecordById(id);
    if (!saved) {
      throw new AppError(404, "Attendance record not found", "NOT_FOUND");
    }

    const deviceSignals = await this.repo.findLatestDeviceSignals([
      { sessionId: saved.sessionId, studentId: saved.studentId },
    ]);

    return {
      record: this.toCorrectionRow(
        saved,
        deviceSignals.get(`${saved.sessionId}|${saved.studentId}`) ?? null,
      ),
    };
  }

  async getCorrectionHistory(id: string) {
    const record = await this.repo.findAttendanceRecordById(id);
    if (!record) {
      throw new AppError(404, "Attendance record not found", "NOT_FOUND");
    }

    const entries = await AppDataSource.getRepository(AuditChange).find({
      where: { recordType: "attendance", recordId: id },
      order: { createdAt: "DESC" },
    });

    return {
      studentName: record.student?.fullName ?? "Student",
      entries: entries.map((entry) => ({
        id: entry.id,
        actorName: entry.actorName,
        createdAt: entry.createdAt,
        beforeStatus:
          typeof entry.before?.status === "string" ? entry.before.status : null,
        afterStatus:
          typeof entry.after?.status === "string" ? entry.after.status : null,
        reason:
          typeof entry.after?.reason === "string" ? entry.after.reason : null,
      })),
    };
  }

  private toCorrectionRow(
    row: AttendanceRecord,
    deviceSignal: string | null,
  ) {
    const cls = row.session.class;
    const term = cls.term;
    return {
      id: row.id,
      sessionId: row.sessionId,
      studentName: row.student.fullName,
      subject: cls.subject || cls.name,
      termName: term?.name ?? cls.termName ?? null,
      year: term?.academicYear?.year ?? null,
      yearLevel: term?.yearLevel?.name ?? null,
      sessionName: `${cls.code} · ${cls.name}`,
      sessionStartAt: row.session.startAt,
      status: row.status,
      scannedAt: row.scannedAt,
      deviceSignal: deviceSignal ?? (row.scannedAt ? null : "no scan"),
      markedManually: row.markedManually,
      manualReason: row.manualReason,
      correctedByName: row.markedManually
        ? (row.markedByUser?.fullName ?? null)
        : null,
      correctedAt: row.markedManually ? row.updatedAt : null,
    };
  }
}

export const adminAttendanceService = new AdminAttendanceService();
