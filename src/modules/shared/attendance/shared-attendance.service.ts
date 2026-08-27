import { In } from "typeorm";
import { AttendanceRepository } from "./attendance.repository.js";
import {
  AssessmentStudent,
  AttendanceStatus,
  Enrollment,
  ClassStudent,
  User,
} from "../../../entities/index.js";
import { AppError } from "../../../common/errors/AppError.js";
import { AppDataSource } from "../../../config/data-source.js";
import { EnrollmentStatus } from "../../../common/constants/enrollment.js";
import { DEFAULT_CLASS_TIMEZONE } from "../../../common/utils/timezone.js";

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

    if (session.class.term?.id && session.class.subject) {
      const classId = session.classId;
      const termId = session.class.term.id;
      const subjectName = session.class.subject.trim().toLowerCase();

      const enrollments = await AppDataSource.getRepository(Enrollment).find({
        where: {
          termId,
          status: In([EnrollmentStatus.ACTIVE, EnrollmentStatus.PENDING]),
        },
        relations: {
          student: true,
          subjects: { subject: true },
        },
      });

      const matchingEnrollments = enrollments.filter((enrolment) => {
        return (enrolment.subjects ?? []).some(
          (s) => s.subject?.name?.trim().toLowerCase() === subjectName,
        );
      });

      const classStudentRepo = AppDataSource.getRepository(ClassStudent);

      for (const enrolment of matchingEnrollments) {
        const studentUserId = enrolment.student?.userId;
        if (studentUserId) {
          const existing = await classStudentRepo.findOne({
            where: {
              classId,
              studentId: studentUserId,
            },
          });

          if (!existing) {
            await classStudentRepo.save(
              classStudentRepo.create({
                classId,
                studentId: studentUserId,
              }),
            );
          }
        }
      }
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
        className: assessment.name,
        classCode: "EXAM",
        room: session.room ?? assessment.room ?? assessment.classroom?.name ?? "",
        startAt: session.startAt,
        endAt: session.endAt,
        gracePeriodMinutes: session.gracePeriodMinutes,
        timeZone: DEFAULT_CLASS_TIMEZONE,
        contentGroup: assessment.subject,
      },
      roll,
    };
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
    const isSyncing = pendingScans.some(
      (s) =>
        s.studentId === student.id && s.deviceSignal === "queued on device",
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
  }
}

export const sharedAttendanceService = new SharedAttendanceService();
