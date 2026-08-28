import { In } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import { EnrollmentStatus } from "../../../common/constants/enrollment.js";
import {
  termYearLevelNumber,
  yearLevelsCompatible,
} from "../../../common/utils/year-level.js";
import {
  Class,
  ClassStudent,
  Enrollment,
  Student,
} from "../../../entities/index.js";

/**
 * Keep class_students aligned with enrolments for this class:
 * - add students enrolled in the same term + subject whose year matches the term
 * - remove roster rows whose student year does not match the class term year
 */
export async function syncClassRosterFromEnrollments(
  classEntity: Class,
): Promise<void> {
  const classId = classEntity.id;
  const termId = classEntity.term?.id ?? null;
  const subjectName = (classEntity.subject ?? "").trim().toLowerCase();
  if (!termId || !subjectName) return;

  const termYear = termYearLevelNumber(classEntity.term);
  const classStudentRepo = AppDataSource.getRepository(ClassStudent);
  const studentRepo = AppDataSource.getRepository(Student);

  const enrollments = await AppDataSource.getRepository(Enrollment).find({
    where: {
      termId,
      status: In([EnrollmentStatus.ACTIVE]),
    },
    relations: {
      student: true,
      subjects: { subject: true },
    },
  });

  const matchingUserIds = new Set<string>();
  for (const enrolment of enrollments) {
    const hasSubject = (enrolment.subjects ?? []).some(
      (row) => row.subject?.name?.trim().toLowerCase() === subjectName,
    );
    if (!hasSubject) continue;
    if (
      !yearLevelsCompatible(enrolment.student?.yearLevel ?? null, termYear)
    ) {
      continue;
    }
    const userId = enrolment.student?.userId;
    if (!userId) continue;
    matchingUserIds.add(userId);

    const existing = await classStudentRepo.findOne({
      where: { classId, studentId: userId },
    });
    if (!existing) {
      await classStudentRepo.save(
        classStudentRepo.create({ classId, studentId: userId }),
      );
    }
  }

  const roster = await classStudentRepo.find({ where: { classId } });
  if (roster.length === 0 || termYear == null) return;

  const userIds = roster.map((row) => row.studentId);
  const profiles = await studentRepo.find({
    where: { userId: In(userIds) },
  });
  const yearByUserId = new Map(
    profiles
      .filter((row) => row.userId)
      .map((row) => [row.userId as string, row.yearLevel]),
  );

  for (const row of roster) {
    const studentYear = yearByUserId.get(row.studentId);
    if (studentYear == null) continue;
    if (!yearLevelsCompatible(studentYear, termYear)) {
      await classStudentRepo.remove(row);
    }
  }
}
