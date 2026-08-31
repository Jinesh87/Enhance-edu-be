import { AppDataSource } from "../../../config/data-source.js";
import { AppError } from "../../../common/errors/AppError.js";
import { GuardianStudent, Student } from "../../../entities/index.js";
import { settingsService } from "../../settings/settings.service.js";

export type GuardianPortalFeature =
  | "classDetails"
  | "assessments"
  | "entranceExams"
  | "attendance";

const featureChecks: Record<
  GuardianPortalFeature,
  () => Promise<boolean>
> = {
  classDetails: () => settingsService.isGuardianPortalClassDetailsEnabled(),
  assessments: () => settingsService.isGuardianPortalAssessmentsEnabled(),
  entranceExams: () => settingsService.isGuardianPortalEntranceExamsEnabled(),
  attendance: () => settingsService.isGuardianPortalAttendanceEnabled(),
};

export async function resolveLinkedStudentForGuardian(
  guardianUserId: string,
  studentEntityId: string,
  feature: GuardianPortalFeature | GuardianPortalFeature[],
): Promise<{ student: Student; studentUserId: string }> {
  const features = Array.isArray(feature) ? feature : [feature];
  const enabledFlags = await Promise.all(
    features.map((item) => featureChecks[item]()),
  );
  if (!enabledFlags.some(Boolean)) {
    throw new AppError(
      403,
      "This information is not available in the guardian portal",
      "GUARDIAN_PORTAL_DISABLED",
    );
  }

  const links = AppDataSource.getRepository(GuardianStudent);
  const link = await links.findOne({
    where: { guardianId: guardianUserId, studentId: studentEntityId },
    relations: { student: true },
  });
  if (!link) {
    throw new AppError(404, "Student not found", "STUDENT_NOT_FOUND");
  }

  const student = link.student as Student;
  if (!student.userId) {
    throw new AppError(
      400,
      "This student does not have a login account yet",
      "STUDENT_LOGIN_MISSING",
    );
  }

  return { student, studentUserId: student.userId };
}
