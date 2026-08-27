import { In } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import {
  DEFAULT_CLASS_TIMEZONE,
  zonedWallTimeToUtc,
} from "../../../common/utils/timezone.js";
import {
  Assessment,
  AttendanceRecord,
  AttendanceStatus,
  Session,
  type AssessmentScheduleType,
} from "../../../entities/index.js";
import { adminAssessmentsRepository } from "../assessments/admin-assessments.repository.js";

function normalizeDateKey(value: string | Date): string | null {
  if (typeof value === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    return match?.[1] ?? null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return null;
}

export function assessmentScheduleWindow(
  assessmentDate: string | Date,
  startTime: string,
  durationMinutes: number,
  scheduleType: AssessmentScheduleType = "SESSION",
): { startAt: Date; endAt: Date } | null {
  const dateKey = normalizeDateKey(assessmentDate);
  if (!dateKey) return null;
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = (scheduleType === "FULL_DAY" ? "00:00" : startTime)
    .split(":")
    .map(Number);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return null;
  }
  const startAt = zonedWallTimeToUtc(
    { year, month, day, hour, minute, second: 0 },
    DEFAULT_CLASS_TIMEZONE,
  );
  if (Number.isNaN(startAt.getTime())) return null;
  const duration =
    scheduleType === "FULL_DAY"
      ? 1440
      : Math.max(durationMinutes || 60, 15);
  return {
    startAt,
    endAt: new Date(startAt.getTime() + duration * 60_000),
  };
}

/**
 * Keeps a Session row in sync with an Assessment so roll / check-in can reuse
 * the existing attendance pipeline.
 */
export class AssessmentSessionSyncService {
  private readonly sessions = AppDataSource.getRepository(Session);
  private readonly attendance = AppDataSource.getRepository(AttendanceRecord);
  private readonly assessments = adminAssessmentsRepository;

  async syncFromAssessment(assessmentId: string): Promise<Session | null> {
    const assessment = await this.assessments.findById(assessmentId);
    if (!assessment) return null;

    if (
      assessment.status === "ARCHIVED" ||
      assessment.status === "CANCELLED"
    ) {
      await this.sessions.delete({ assessmentId });
      return null;
    }

    const window = assessmentScheduleWindow(
      assessment.assessmentDate,
      assessment.startTime,
      assessment.durationMinutes,
      assessment.scheduleType,
    );
    if (!window) return null;

    const room =
      assessment.room?.trim() ||
      assessment.classroom?.name?.trim() ||
      null;

    let session = await this.sessions.findOne({
      where: { assessmentId: assessment.id },
    });

    if (!session) {
      session = this.sessions.create({
        assessmentId: assessment.id,
        classId: assessment.classId,
        startAt: window.startAt,
        endAt: window.endAt,
        room,
        classroomId: assessment.classroomId,
        teacherId: assessment.teacherId,
        gracePeriodMinutes:
          assessment.scheduleType === "FULL_DAY" ? 1440 : 25,
      });
    } else {
      session.classId = assessment.classId;
      session.startAt = window.startAt;
      session.endAt = window.endAt;
      session.room = room;
      session.classroomId = assessment.classroomId;
      session.teacherId = assessment.teacherId;
      session.gracePeriodMinutes =
        assessment.scheduleType === "FULL_DAY" ? 1440 : 25;
    }

    const saved = await this.sessions.save(session);
    await this.seedAttendance(saved.id, assessment.id);
    return saved;
  }

  async findByAssessmentId(assessmentId: string): Promise<Session | null> {
    return this.sessions.findOne({
      where: { assessmentId },
      relations: {
        class: { teacher: true, term: true },
        assessment: { teacher: true, term: true },
      },
    });
  }

  async ensureForTeacher(teacherId: string): Promise<void> {
    const rows = await AppDataSource.getRepository(Assessment).find({
      where: { teacherId },
      select: { id: true, status: true },
    });
    for (const row of rows) {
      if (row.status === "ARCHIVED" || row.status === "CANCELLED") continue;
      await this.syncFromAssessment(row.id);
    }
  }

  private async seedAttendance(sessionId: string, assessmentId: string) {
    const studentIds =
      await this.assessments.findSittingStudentIds(assessmentId);
    if (studentIds.length === 0) return;

    const existing = await this.attendance.find({
      where: { sessionId, studentId: In(studentIds) },
      select: { studentId: true },
    });
    const have = new Set(existing.map((row) => row.studentId));
    const missing = studentIds.filter((id) => !have.has(id));
    if (missing.length === 0) return;

    await this.attendance.save(
      missing.map((studentId) =>
        this.attendance.create({
          sessionId,
          studentId,
          status: AttendanceStatus.PENDING,
          scannedAt: null,
        }),
      ),
    );
  }
}

export const assessmentSessionSyncService =
  new AssessmentSessionSyncService();
