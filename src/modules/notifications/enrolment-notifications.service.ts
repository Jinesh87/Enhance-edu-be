import { In } from "typeorm";
import { UserRole, UserStatus } from "../../common/constants/roles.js";
import { env } from "../../config/env.js";
import { AppDataSource } from "../../config/data-source.js";
import { logger } from "../../config/logger.js";
import {
  Class,
  Enquiry,
  PendingEnrollment,
  ReminderDispatch,
  Student,
  User,
} from "../../entities/index.js";
import { emailService } from "../email/email.service.js";
import { settingsService } from "../settings/settings.service.js";
import {
  classRosterStudentAddedNotificationPayload,
  enquiryCreatedNotificationPayload,
  notifyUsers,
  trialBookingConfirmedNotificationPayload,
} from "./domain-notifications.js";

const CHANNEL_CONCURRENCY = 5;

async function mapPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  if (items.length === 0) return;
  let index = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (index < items.length) {
        const current = index;
        index += 1;
        await worker(items[current]!);
      }
    },
  );
  await Promise.all(runners);
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const withCode = error as {
    code?: unknown;
    driverError?: { code?: unknown };
  };
  const code = String(withCode.code ?? withCode.driverError?.code ?? "");
  return code === "23505";
}

async function claimDispatch(
  dispatchKey: string,
  kind: string,
): Promise<boolean> {
  const repo = AppDataSource.getRepository(ReminderDispatch);
  try {
    await repo.insert({ dispatchKey, kind });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    logger.warn({ err: error, dispatchKey }, "Enrolment notify claim failed");
    return false;
  }
}

export async function notifyStaffOfEnquiryCreated(input: {
  enquiry: Enquiry;
  actorId: string;
}): Promise<void> {
  try {
    if (!(await settingsService.isEnquiryCreatedNotifyEnabled())) return;
    if (!(await claimDispatch(`enquiry-new:${input.enquiry.id}`, "ENQUIRY_CREATED"))) {
      return;
    }

    const staff = await AppDataSource.getRepository(User).find({
      where: [
        { role: UserRole.SUPER_ADMIN, status: UserStatus.ACTIVE },
        { role: UserRole.OFFICE_STAFF, status: UserStatus.ACTIVE },
      ],
      select: { id: true, email: true, fullName: true },
    });

    const recipients = staff.filter((u) => u.id !== input.actorId);
    if (recipients.length === 0) return;

    const studentName =
      input.enquiry.studentFullName?.trim() || "Student";
    const guardianName =
      input.enquiry.guardianFullName?.trim() || "Guardian";
    const subject =
      input.enquiry.subjectOfInterest?.trim() || "Subject";
    const payload = enquiryCreatedNotificationPayload({
      enquiryId: input.enquiry.id,
      studentName,
      guardianName,
      subjectOfInterest: subject,
    });

    await notifyUsers(
      recipients.map((user) => ({
        userId: user.id,
        ...payload,
      })),
    );

    const enquiryLink = `${env.FRONTEND_URL}/admin/enquiries/${input.enquiry.id}`;
    const emailTargets = recipients.filter((u) => Boolean(u.email?.trim()));
    await mapPool(emailTargets, CHANNEL_CONCURRENCY, async (user) => {
      try {
        await emailService.sendEnquiryCapturedEmail({
          to: user.email!.trim(),
          staffName: user.fullName?.trim() || "Team",
          studentName,
          guardianName,
          subjectOfInterest: subject,
          enquiryLink,
        });
      } catch (error) {
        logger.warn(
          { err: error, userId: user.id },
          "Enquiry captured email failed",
        );
      }
    });
  } catch (error) {
    logger.warn(
      { err: error, enquiryId: input.enquiry.id },
      "Failed to notify staff of enquiry create",
    );
  }
}

export async function notifyTrialBookingConfirmed(input: {
  enquiry: Enquiry;
}): Promise<void> {
  try {
    if (!(await settingsService.isTrialBookingConfirmedNotifyEnabled())) {
      return;
    }
    if (
      !(await claimDispatch(
        `trial-confirmed:${input.enquiry.id}`,
        "TRIAL_BOOKING_CONFIRMED",
      ))
    ) {
      return;
    }

    const email = input.enquiry.guardianEmail?.trim().toLowerCase();
    if (!email) return;

    const guardian = await AppDataSource.getRepository(User).findOne({
      where: { email, role: UserRole.GUARDIAN },
      select: { id: true, email: true, mobile: true, fullName: true },
    });

    const classLabel =
      input.enquiry.trialClassName?.trim() ||
      input.enquiry.subjectOfInterest?.trim() ||
      "trial class";
    const studentName =
      input.enquiry.studentFullName?.trim() || "Student";

    const studentUserIds = new Set<string>();
    if (input.enquiry.trialTermId && guardian?.id) {
      const students = await AppDataSource.getRepository(Student)
        .createQueryBuilder("student")
        .innerJoin(
          "enrollments",
          "enrollment",
          'enrollment."studentId" = student.id',
        )
        .where('enrollment."guardianId" = :guardianId', {
          guardianId: guardian.id,
        })
        .andWhere('enrollment."termId" = :termId', {
          termId: input.enquiry.trialTermId,
        })
        .andWhere("student.\"userId\" IS NOT NULL")
        .select(["student.id", "student.userId", "student.fullName"])
        .getMany();
      for (const student of students) {
        if (student.userId) studentUserIds.add(student.userId);
      }
    }

    const notifyInputs = [];
    if (guardian?.id) {
      notifyInputs.push({
        userId: guardian.id,
        ...trialBookingConfirmedNotificationPayload({
          studentName,
          classLabel,
          forGuardian: true,
        }),
      });
    }
    for (const userId of studentUserIds) {
      notifyInputs.push({
        userId,
        ...trialBookingConfirmedNotificationPayload({
          studentName,
          classLabel,
          forGuardian: false,
        }),
      });
    }
    if (notifyInputs.length > 0) {
      await notifyUsers(notifyInputs);
    }

    const portalGuardian = `${env.FRONTEND_URL}/guardian/students`;
    const portalStudent = `${env.FRONTEND_URL}/student`;

    if (guardian?.email?.trim()) {
      try {
        await emailService.sendTrialConfirmedEmail({
          to: guardian.email.trim(),
          fullName: guardian.fullName?.trim() || "Parent",
          studentName,
          classLabel,
          portalLink: portalGuardian,
        });
      } catch (error) {
        logger.warn({ err: error }, "Trial confirmed guardian email failed");
      }
    }

    if (studentUserIds.size > 0) {
      const students = await AppDataSource.getRepository(User).find({
        where: { id: In([...studentUserIds]) },
        select: { id: true, email: true, fullName: true },
      });
      await mapPool(
        students.filter((s) => Boolean(s.email?.trim())),
        CHANNEL_CONCURRENCY,
        async (student) => {
          try {
            await emailService.sendTrialConfirmedEmail({
              to: student.email!.trim(),
              fullName: student.fullName?.trim() || studentName,
              studentName,
              classLabel,
              portalLink: portalStudent,
            });
          } catch (error) {
            logger.warn(
              { err: error, userId: student.id },
              "Trial confirmed student email failed",
            );
          }
        },
      );
    }

    const smsTargets: string[] = [];
    if (guardian?.mobile?.trim()) smsTargets.push(guardian.mobile.trim());
    if (smsTargets.length > 0) {
      const body = `Trial confirmed: ${studentName} · ${classLabel}. Open the app for details.`;
      await mapPool(smsTargets, CHANNEL_CONCURRENCY, async (to) => {
        try {
          await emailService.sendSessionChangeSms({ to, body });
        } catch (error) {
          logger.warn({ err: error, to }, "Trial confirmed SMS failed");
        }
      });
    }
  } catch (error) {
    logger.warn(
      { err: error, enquiryId: input.enquiry.id },
      "Failed to notify trial booking confirmed",
    );
  }
}

export async function notifyEnrollmentAcceptedExtras(input: {
  pending: PendingEnrollment;
  enrollmentId: string;
  guardian: Pick<User, "id" | "fullName"> & { email?: string | null };
  student:
    | Pick<Student, "id" | "fullName" | "userId">
    | { id: string; fullName: string; userId?: string | null }
    | null
    | undefined;
  isTrial: boolean;
}): Promise<void> {
  try {
    if (input.isTrial) return;
    if (!(await settingsService.isEnrollmentAcceptedNotifyEnabled())) return;
    if (
      !(await claimDispatch(
        `enrollment-accepted:${input.enrollmentId}`,
        "ENROLLMENT_ACCEPTED",
      ))
    ) {
      return;
    }

    const studentName =
      input.student?.fullName?.trim() ||
      input.pending.studentFullName.trim() ||
      "Student";
    const isModification = Boolean(input.pending.replacesEnrollmentId);

    await notifyUsers([
      {
        userId: input.guardian.id,
        type: "ENROLLMENT_ACCEPTED",
        title: isModification ? "Enrolment change confirmed" : "Enrolment confirmed",
        body: isModification
          ? `Your enrolment update for ${studentName} is confirmed.`
          : `Enrolment for ${studentName} is confirmed.`,
        data: {
          enrollmentId: input.enrollmentId,
          href: "/guardian/students",
        },
      },
    ]);

    if (input.guardian.email?.trim()) {
      try {
        await emailService.sendEnrollmentAcceptedEmail({
          to: input.guardian.email.trim(),
          fullName: input.guardian.fullName?.trim() || "Parent",
          studentName,
          portalLink: `${env.FRONTEND_URL}/guardian/students`,
          isStudent: false,
        });
      } catch (error) {
        logger.warn({ err: error }, "Enrolment accepted guardian email failed");
      }
    }

    const studentUserId = input.student?.userId ?? null;
    if (studentUserId) {
      const studentUser = await AppDataSource.getRepository(User).findOne({
        where: { id: studentUserId },
        select: { id: true, email: true, fullName: true },
      });
      if (studentUser?.email?.trim()) {
        try {
          await emailService.sendEnrollmentAcceptedEmail({
            to: studentUser.email.trim(),
            fullName: studentUser.fullName?.trim() || studentName,
            studentName,
            portalLink: `${env.FRONTEND_URL}/student`,
            isStudent: true,
          });
        } catch (error) {
          logger.warn({ err: error }, "Enrolment accepted student email failed");
        }
      }
    }
  } catch (error) {
    logger.warn(
      { err: error, enrollmentId: input.enrollmentId },
      "Failed enrolment accepted extras notify",
    );
  }
}

export async function notifyTutorOfRosterStudentAdded(input: {
  classEntity: Class;
  studentUserId: string;
  studentName: string;
}): Promise<void> {
  try {
    if (!(await settingsService.isClassRosterStudentAddedNotifyEnabled())) {
      return;
    }

    let teacherId =
      input.classEntity.teacher?.id ??
      (input.classEntity as Class & { teacherId?: string | null }).teacherId ??
      null;
    if (!teacherId) {
      const refreshed = await AppDataSource.getRepository(Class).findOne({
        where: { id: input.classEntity.id },
        relations: { teacher: true },
      });
      teacherId = refreshed?.teacher?.id ?? null;
    }
    if (!teacherId) return;

    if (
      !(await claimDispatch(
        `class-roster:${input.classEntity.id}:${input.studentUserId}`,
        "CLASS_ROSTER_STUDENT_ADDED",
      ))
    ) {
      return;
    }

    const payload = classRosterStudentAddedNotificationPayload({
      studentName: input.studentName,
      className: input.classEntity.name?.trim() || "class",
      classId: input.classEntity.id,
    });
    await notifyUsers([{ userId: teacherId, ...payload }]);
  } catch (error) {
    logger.warn(
      {
        err: error,
        classId: input.classEntity.id,
        studentUserId: input.studentUserId,
      },
      "Failed to notify tutor of roster add",
    );
  }
}

/** Sync classes for an enrolment's term + subjects and notify tutors on new roster rows. */
export async function syncRosterForEnrollment(input: {
  termId: string;
  subjectNames: string[];
}): Promise<void> {
  try {
    const names = input.subjectNames
      .map((n) => n.trim().toLowerCase())
      .filter(Boolean);
    if (!input.termId || names.length === 0) return;

    const { syncClassRosterFromEnrollments } = await import(
      "../shared/classes/sync-class-roster.js"
    );

    const classes = await AppDataSource.getRepository(Class).find({
      where: { term: { id: input.termId } },
      relations: { term: true, teacher: true },
    });

    for (const cls of classes) {
      const subject = (cls.subject ?? "").trim().toLowerCase();
      if (!subject || !names.includes(subject)) continue;
    await syncClassRosterFromEnrollments(cls);
  }
  } catch (error) {
    logger.warn({ err: error }, "Failed roster sync after enrolment");
  }
}
