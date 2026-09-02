import { AttendanceRepository } from "./attendance.repository.js";
import {
  AssessmentStudent,
  AttendanceStatus,
  User,
} from "../../../entities/index.js";
import { ScanFlagReason, ScanStatus } from "../../../entities/ScanEvent.js";
import { AppError } from "../../../common/errors/AppError.js";
import { AppDataSource } from "../../../config/data-source.js";
import { DEFAULT_CLASS_TIMEZONE } from "../../../common/utils/timezone.js";
import { resolveAssessmentTimeZone } from "../../admin/assessments/assessment-schedule.utils.js";
import { syncClassRosterFromEnrollments } from "../classes/sync-class-roster.js";

export class SharedAttendanceService {
  private readonly repo = new AttendanceRepository();

  async getLiveRollData(sessionId: string) {
    const session = await this.repo.findSessionWithClassById(sessionId);
    if (!session) {
      throw new AppError(404, "Session not found", "SESSION_NOT_FOUND");
    }

    if (session.assessmentId) {
      return this.getAssessmentLiveRoll(session);
    }

    if (!session.classId || !session.class) {
      throw new AppError(404, "Session not found", "SESSION_NOT_FOUND");
    }

    if (session.class) {
      await syncClassRosterFromEnrollments(session.class);
    }

    const enrols = await this.repo.findEnrolmentsByClassId(session.classId);

    const attendanceRecords =
      await this.repo.findAttendanceRecordsBySessionId(sessionId);

    const pendingScans = await this.repo.findPendingScansBySessionId(sessionId);

    const roll = enrols.map((enrol) => {
      const student = enrol.student;
      return this.toRollRow(student, attendanceRecords, pendingScans);
    });

    return {
      session: {
        kind: "class" as const,
        className: session.class.name,
        classCode: session.class.code,
        room: session.room ?? session.class.room,
        startAt: session.startAt,
        endAt: session.endAt,
        gracePeriodMinutes: session.gracePeriodMinutes,
        timeZone: session.class.timeZone ?? DEFAULT_CLASS_TIMEZONE,
        contentGroup: session.class.contentGroup,
      },
      roll,
    };
  }

  private async getAssessmentLiveRoll(session: NonNullable<
    Awaited<ReturnType<AttendanceRepository["findSessionWithClassById"]>>
  >) {
    const assessment = session.assessment;
    if (!assessment) {
      throw new AppError(404, "Assessment not found", "ASSESSMENT_NOT_FOUND");
    }

    const sitting = await AppDataSource.getRepository(AssessmentStudent).find({
      where: { assessmentId: assessment.id },
      relations: { student: true },
    });

    const students = sitting
      .map((row) => row.student)
      .filter((student): student is User => Boolean(student))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));

    const attendanceRecords =
      await this.repo.findAttendanceRecordsBySessionId(session.id);
    const pendingScans = await this.repo.findPendingScansBySessionId(
      session.id,
    );

    const roll = students.map((student) =>
      this.toRollRow(student, attendanceRecords, pendingScans),
    );

    return {
      session: {
        kind: "assessment" as const,
        assessmentId: assessment.id,
        scheduleType: assessment.scheduleType ?? "SESSION",
        className: assessment.name,
        classCode: "EXAM",
        room: session.room ?? assessment.room ?? assessment.classroom?.name ?? "",
        startAt: session.startAt,
        endAt: session.endAt,
        gracePeriodMinutes: session.gracePeriodMinutes,
        timeZone: resolveAssessmentTimeZone(assessment.timeZone),
        contentGroup: assessment.subject,
      },
      roll,
    };
  }

  private formatRollTime(value: Date): string {
    const hours = String(value.getHours()).padStart(2, "0");
    const mins = String(value.getMinutes()).padStart(2, "0");
    const secs = String(value.getSeconds()).padStart(2, "0");
    return `${hours}:${mins}:${secs}`;
  }

  private toRollRow(
    student: User,
    attendanceRecords: Awaited<
      ReturnType<AttendanceRepository["findAttendanceRecordsBySessionId"]>
    >,
    pendingScans: Awaited<
      ReturnType<AttendanceRepository["findPendingScansBySessionId"]>
    >,
  ) {
    const record = attendanceRecords.find((r) => r.studentId === student.id);
    const studentPendingScans = pendingScans.filter(
      (s) => s.studentId === student.id,
    );
    const isSyncing = studentPendingScans.some(
      (s) => s.deviceSignal === "queued on device",
    );

    const latestFlaggedScan = [...studentPendingScans]
      .filter(
        (scan) =>
          scan.status === ScanStatus.PENDING &&
          scan.reasonFlagged !== ScanFlagReason.NONE,
      )
      .sort((a, b) => b.scannedAt.getTime() - a.scannedAt.getTime())[0];

    let status = "Not scanned";
    let scannedAt: Date | null = null;
    let exceptionReason: string | null = null;

    if (isSyncing) {
      status = "Syncing...";
    } else if (latestFlaggedScan) {
      status = "Exception";
      exceptionReason = latestFlaggedScan.reasonFlagged;
      scannedAt = latestFlaggedScan.scannedAt;
    } else if (record) {
      if (record.status === AttendanceStatus.PRESENT) {
        status = "Present";
      } else if (record.status === AttendanceStatus.LATE) {
        status = "Late";
      } else if (record.status === AttendanceStatus.EXCEPTION) {
        status = "Exception";
      } else if (record.status === AttendanceStatus.EXCUSED) {
        status = "Excused";
      } else if (record.status === AttendanceStatus.ABSENT) {
        status = record.scannedAt ? "Grace exception" : "Absent";
      }

      if (record.scannedAt) {
        scannedAt = record.scannedAt;
      }
    }

    return {
      id: student.id,
      fullName: student.fullName,
      preferredName: student.preferredName,
      status,
      time: scannedAt ? this.formatRollTime(scannedAt) : "",
      scannedAt: scannedAt ? scannedAt.toISOString() : null,
      exceptionReason,
    };
  }
}

export const sharedAttendanceService = new SharedAttendanceService();
