import { In } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import { AppError } from "../../../common/errors/AppError.js";
import {
  AttendanceRecord,
  AttendanceStatus,
  ClassFeedback,
  GuardianStudent,
  Session,
  Student,
} from "../../../entities/index.js";

/** How long after a class ends a guardian can still leave or edit feedback. */
export const FEEDBACK_WINDOW_DAYS = 30;

const ATTENDED = [AttendanceStatus.PRESENT, AttendanceStatus.LATE];

export type GuardianFeedbackItem = {
  sessionId: string;
  classId: string;
  className: string;
  subject: string | null;
  startAt: string;
  endAt: string;
  teacherName: string | null;
  attendance: string;
  student: { id: string; name: string };
  feedback: {
    id: string;
    rating: number;
    comment: string | null;
    updatedAt: string;
  } | null;
};

type AttendedRow = {
  sessionId: string;
  studentUserId: string;
  status: string;
  startAt: Date;
  endAt: Date;
  classId: string;
  className: string;
  subject: string | null;
  sessionTeacher: string | null;
  sessionTeacherPreferred: string | null;
  classTeacher: string | null;
  classTeacherPreferred: string | null;
};

function windowStart() {
  return new Date(Date.now() - FEEDBACK_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

function studentName(student: Student) {
  return student.preferredName || student.fullName;
}

class GuardianFeedbackService {
  private async linkedStudents(guardianUserId: string) {
    const links = await AppDataSource.getRepository(GuardianStudent).find({
      where: { guardianId: guardianUserId },
      relations: { student: true },
    });
    return links
      .map((link) => link.student as Student)
      .filter((student) => Boolean(student?.userId));
  }

  async list(guardianUserId: string): Promise<GuardianFeedbackItem[]> {
    const students = await this.linkedStudents(guardianUserId);
    if (students.length === 0) return [];
    const byUserId = new Map(students.map((s) => [s.userId as string, s]));

    const rows: AttendedRow[] = await AppDataSource.getRepository(AttendanceRecord)
      .createQueryBuilder("ar")
      .innerJoin("ar.session", "s")
      .innerJoin("s.class", "c")
      .leftJoin("s.teacher", "st")
      .leftJoin("c.teacher", "ct")
      .select("ar.sessionId", "sessionId")
      .addSelect("ar.studentId", "studentUserId")
      .addSelect("ar.status", "status")
      .addSelect("s.startAt", "startAt")
      .addSelect("s.endAt", "endAt")
      .addSelect("c.id", "classId")
      .addSelect("c.name", "className")
      .addSelect("c.subject", "subject")
      .addSelect("st.fullName", "sessionTeacher")
      .addSelect("st.preferredName", "sessionTeacherPreferred")
      .addSelect("ct.fullName", "classTeacher")
      .addSelect("ct.preferredName", "classTeacherPreferred")
      .where("ar.studentId IN (:...ids)", { ids: [...byUserId.keys()] })
      .andWhere("ar.status IN (:...attended)", { attended: ATTENDED })
      .andWhere("s.endAt <= now()")
      .andWhere("s.endAt >= :since", { since: windowStart() })
      .orderBy("s.startAt", "DESC")
      .limit(200)
      .getRawMany();

    if (rows.length === 0) return [];

    const feedback = await AppDataSource.getRepository(ClassFeedback).find({
      where: {
        guardianUserId,
        sessionId: In([...new Set(rows.map((r) => r.sessionId))]),
      },
    });
    const feedbackKey = (sessionId: string, studentId: string) => `${sessionId}:${studentId}`;
    const feedbackBy = new Map(feedback.map((f) => [feedbackKey(f.sessionId, f.studentId), f]));

    return rows.flatMap((row) => {
      const student = byUserId.get(row.studentUserId);
      if (!student) return [];
      const existing = feedbackBy.get(feedbackKey(row.sessionId, student.id));
      return [
        {
          sessionId: row.sessionId,
          classId: row.classId,
          className: row.className,
          subject: row.subject,
          startAt: new Date(row.startAt).toISOString(),
          endAt: new Date(row.endAt).toISOString(),
          teacherName:
            row.sessionTeacherPreferred ||
            row.sessionTeacher ||
            row.classTeacherPreferred ||
            row.classTeacher ||
            null,
          attendance: row.status,
          student: { id: student.id, name: studentName(student) },
          feedback: existing
            ? {
                id: existing.id,
                rating: existing.rating,
                comment: existing.comment,
                updatedAt: existing.updatedAt.toISOString(),
              }
            : null,
        },
      ];
    });
  }

  async submit(
    guardianUserId: string,
    input: { sessionId: string; studentId: string; rating: number; comment?: string | null },
  ) {
    const link = await AppDataSource.getRepository(GuardianStudent).findOne({
      where: { guardianId: guardianUserId, studentId: input.studentId },
      relations: { student: true },
    });
    const student = link?.student as Student | undefined;
    if (!student) {
      throw new AppError(404, "Student not found", "STUDENT_NOT_FOUND");
    }
    if (!student.userId) {
      throw new AppError(400, "This student has no attendance record for that class", "NOT_ATTENDED");
    }

    const session = await AppDataSource.getRepository(Session).findOne({
      where: { id: input.sessionId },
    });
    if (!session || !session.classId) {
      throw new AppError(404, "Class not found", "SESSION_NOT_FOUND");
    }
    if (session.endAt.getTime() > Date.now()) {
      throw new AppError(400, "Feedback opens once the class has finished", "CLASS_NOT_FINISHED");
    }
    if (session.endAt < windowStart()) {
      throw new AppError(
        400,
        `Feedback closes ${FEEDBACK_WINDOW_DAYS} days after the class`,
        "FEEDBACK_CLOSED",
      );
    }

    const attendance = await AppDataSource.getRepository(AttendanceRecord).findOne({
      where: { sessionId: session.id, studentId: student.userId },
    });
    if (!attendance || !ATTENDED.includes(attendance.status)) {
      throw new AppError(
        400,
        "Feedback is only available for classes your student attended",
        "NOT_ATTENDED",
      );
    }

    const repo = AppDataSource.getRepository(ClassFeedback);
    const comment = input.comment?.trim() || null;
    let row = await repo.findOne({
      where: { sessionId: session.id, studentId: student.id, guardianUserId },
    });
    if (row) {
      row.rating = input.rating;
      row.comment = comment;
    } else {
      row = repo.create({
        sessionId: session.id,
        classId: session.classId,
        studentId: student.id,
        guardianUserId,
        rating: input.rating,
        comment,
      });
    }
    const saved = await repo.save(row);
    return {
      id: saved.id,
      rating: saved.rating,
      comment: saved.comment,
      updatedAt: saved.updatedAt.toISOString(),
    };
  }
}

export const guardianFeedbackService = new GuardianFeedbackService();
