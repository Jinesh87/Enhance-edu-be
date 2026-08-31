import { In, IsNull, MoreThanOrEqual } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import {
  Assessment,
  AssessmentSubmission,
  AttendanceRecord,
  AttendanceStatus,
  Session,
} from "../../../entities/index.js";
import { AttendanceRepository } from "../../shared/attendance/attendance.repository.js";
import {
  studentClassesService,
  type StudentLessonDto,
} from "../../student/classes/student-classes.service.js";
import { studentEntranceExamsService } from "../../student/entrance-exams/student-entrance-exams.service.js";
import { resolveLinkedStudentForGuardian } from "../shared/guardian-student-access.js";

function sanitizeLesson(lesson: StudentLessonDto): StudentLessonDto {
  return {
    ...lesson,
    canCheckIn: false,
    resources: lesson.resources.map((resource) => ({
      ...resource,
      downloadable: false,
    })),
  };
}

function sanitizeTimetable(data: Awaited<
  ReturnType<typeof studentClassesService.getTimetable>
>) {
  return {
    ...data,
    nextLesson: data.nextLesson ? sanitizeLesson(data.nextLesson) : null,
    today: data.today.map(sanitizeLesson),
    week: data.week.map(sanitizeLesson),
    lessons: data.lessons.map(sanitizeLesson),
  };
}

function sanitizeSubmission(submission: AssessmentSubmission, assessment: Assessment | null) {
  return {
    id: submission.id,
    assessmentId: submission.assessmentId,
    studentId: submission.studentId,
    status: submission.status,
    submittedAt: submission.submittedAt?.toISOString() ?? null,
    mark: submission.mark != null ? Number(submission.mark) : null,
    markNotes: submission.markNotes ?? null,
    markedAt: submission.markedAt?.toISOString() ?? null,
    files: (submission.files ?? [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((file) => ({
        id: file.id,
        originalName: file.originalName,
        mimeType: file.mimeType,
        byteSize: file.byteSize,
        sortOrder: file.sortOrder,
      })),
    assessment: assessment
      ? {
          id: assessment.id,
          name: assessment.name,
          subject: assessment.subject,
          yearGroup: assessment.yearGroup,
          termId: assessment.termId,
          termLabel: assessment.term?.name ?? "",
          assessmentDate: assessment.assessmentDate,
          startTime: assessment.startTime,
          durationMinutes: assessment.durationMinutes,
          kind: assessment.kind,
          totalMarks:
            assessment.totalMarks != null ? Number(assessment.totalMarks) : null,
          cutOffMarks:
            assessment.cutOffMarks != null ? Number(assessment.cutOffMarks) : null,
        }
      : null,
  };
}

function attendanceStatusLabel(status: AttendanceStatus | null) {
  if (!status) return "Not recorded";
  if (status === AttendanceStatus.PRESENT) return "Present";
  if (status === AttendanceStatus.LATE) return "Late";
  if (status === AttendanceStatus.EXCUSED) return "Excused";
  if (status === AttendanceStatus.ABSENT) return "Absent";
  if (status === AttendanceStatus.EXCEPTION) return "Exception";
  return status;
}

export class GuardianAcademicsService {
  private readonly repo = new AttendanceRepository();
  private readonly submissions = AppDataSource.getRepository(AssessmentSubmission);
  private readonly assessments = AppDataSource.getRepository(Assessment);

  async getTimetable(guardianUserId: string, studentEntityId: string) {
    const { studentUserId } = await resolveLinkedStudentForGuardian(
      guardianUserId,
      studentEntityId,
      ["classDetails", "assessments"],
    );
    const data = await studentClassesService.getTimetable(studentUserId);
    return sanitizeTimetable(data);
  }

  async getLesson(
    guardianUserId: string,
    studentEntityId: string,
    sessionId: string,
  ) {
    const { studentUserId } = await resolveLinkedStudentForGuardian(
      guardianUserId,
      studentEntityId,
      ["classDetails", "assessments"],
    );
    const lesson = await studentClassesService.getLesson(studentUserId, sessionId);
    return { lesson: sanitizeLesson(lesson) };
  }

  async getAssessmentSubmission(
    guardianUserId: string,
    studentEntityId: string,
    assessmentId: string,
  ) {
    const { studentUserId } = await resolveLinkedStudentForGuardian(
      guardianUserId,
      studentEntityId,
      "assessments",
    );

    const submission = await this.submissions.findOne({
      where: { assessmentId, studentId: studentUserId },
      relations: { files: true },
    });
    if (!submission || submission.status === "DRAFT") {
      return { submission: null };
    }

    const assessment = await this.assessments.findOne({
      where: { id: assessmentId },
      relations: { term: true },
    });

    return { submission: sanitizeSubmission(submission, assessment) };
  }

  async listEntranceExams(guardianUserId: string, studentEntityId: string) {
    const { studentUserId } = await resolveLinkedStudentForGuardian(
      guardianUserId,
      studentEntityId,
      "entranceExams",
    );
    return studentEntranceExamsService.listAvailable(studentUserId);
  }

  async getEntranceExamSubmission(
    guardianUserId: string,
    studentEntityId: string,
    assessmentId: string,
  ) {
    const { studentUserId } = await resolveLinkedStudentForGuardian(
      guardianUserId,
      studentEntityId,
      "entranceExams",
    );

    const submission = await this.submissions.findOne({
      where: { assessmentId, studentId: studentUserId },
      relations: { files: true },
    });
    if (!submission || submission.status === "DRAFT") {
      return { submission: null };
    }

    const assessment = await this.assessments.findOne({
      where: { id: assessmentId },
      relations: { term: true },
    });

    return { submission: sanitizeSubmission(submission, assessment) };
  }

  async getAttendance(guardianUserId: string, studentEntityId: string) {
    const { studentUserId } = await resolveLinkedStudentForGuardian(
      guardianUserId,
      studentEntityId,
      "attendance",
    );

    const enrols = await this.repo.findEnrolmentsByStudentId(studentUserId);
    const classIds = enrols.map((row) => row.classId);
    if (classIds.length === 0) {
      return { records: [], stats: { attendancePercent: null } };
    }

    const since = new Date();
    since.setDate(since.getDate() - 90);
    since.setHours(0, 0, 0, 0);

    const sessions = await AppDataSource.getRepository(Session).find({
      where: {
        classId: In(classIds),
        assessmentId: IsNull(),
        startAt: MoreThanOrEqual(since),
      },
      relations: { class: true },
      order: { startAt: "DESC" },
    });

    const attendanceRecords = await this.repo.findAttendanceRecordsByStudentId(
      studentUserId,
    );
    const bySession = new Map(
      attendanceRecords.map((record) => [record.sessionId, record]),
    );

    const now = Date.now();
    const ended = sessions.filter(
      (session) => new Date(session.endAt).getTime() < now,
    );
    const attended = ended.filter((session) => {
      const record = bySession.get(session.id);
      return (
        record?.status === AttendanceStatus.PRESENT ||
        record?.status === AttendanceStatus.LATE ||
        record?.status === AttendanceStatus.EXCUSED
      );
    });

    return {
      records: sessions.map((session) => {
        const record = bySession.get(session.id) as AttendanceRecord | undefined;
        return {
          sessionId: session.id,
          className: session.class?.name ?? session.class?.code ?? "Class",
          room: session.class?.room ?? null,
          startAt: session.startAt.toISOString(),
          endAt: session.endAt.toISOString(),
          status: record?.status ?? null,
          statusLabel: attendanceStatusLabel(record?.status ?? null),
          scannedAt: record?.scannedAt?.toISOString() ?? null,
        };
      }),
      stats: {
        attendancePercent:
          ended.length > 0
            ? Math.round((attended.length / ended.length) * 100)
            : null,
      },
    };
  }
}

export const guardianAcademicsService = new GuardianAcademicsService();
