import { In } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import {
  Assessment,
  AttendanceRecord,
  AttendanceStatus,
  Session,
} from "../../../entities/index.js";
import { adminAssessmentsRepository } from "../assessments/admin-assessments.repository.js";
import { assessmentScheduleWindow } from "./assessment-schedule.utils.js";

export { assessmentScheduleWindow } from "./assessment-schedule.utils.js";
export {
  assertStudentAssessmentWindowOpen,
  resolveAssessmentTimeZone,
} from "./assessment-schedule.utils.js";

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
      assessment.timeZone,
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
