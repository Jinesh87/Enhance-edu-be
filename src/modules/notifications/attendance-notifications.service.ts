import { In } from "typeorm";
import { UserRole, UserStatus } from "../../common/constants/roles.js";
import { AppDataSource } from "../../config/data-source.js";
import { logger } from "../../config/logger.js";
import {
  AttendanceStatus,
  Session,
  User,
} from "../../entities/index.js";
import { emailService } from "../email/email.service.js";
import { settingsService } from "../settings/settings.service.js";
import {
  attendanceCorrectedNotificationPayload,
  attendanceExceptionNotificationPayload,
  attendanceMarkedNotificationPayload,
  notifyUsers,
} from "./domain-notifications.js";
import { resolveGuardianUserIdsForStudentUsers } from "./session-change-notifications.service.js";

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

function sessionLabel(session: Session): string {
  const subject =
    session.assessment?.name?.trim() ||
    session.class?.name?.trim() ||
    "Class";
  const when = session.startAt.toLocaleString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${subject} · ${when}`;
}

function sessionWhenOnly(session: Session): string {
  return session.startAt.toLocaleString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function sessionNameOnly(session: Session): string {
  return (
    session.assessment?.name?.trim() ||
    session.class?.name?.trim() ||
    "Class"
  );
}

async function resolveStudentDisplayName(studentUserId: string): Promise<string> {
  const user = await AppDataSource.getRepository(User).findOne({
    where: { id: studentUserId },
    select: { id: true, fullName: true },
  });
  return user?.fullName?.trim() || "Student";
}

export async function notifyGuardiansOfAttendanceMark(input: {
  session: Session;
  studentUserId: string;
  status: AttendanceStatus;
}): Promise<void> {
  if (
    input.status !== AttendanceStatus.ABSENT &&
    input.status !== AttendanceStatus.LATE
  ) {
    return;
  }

  try {
    const guardiansByStudent = await resolveGuardianUserIdsForStudentUsers([
      input.studentUserId,
    ]);
    const guardianIds = [
      ...(guardiansByStudent.get(input.studentUserId) ?? []),
    ];
    if (guardianIds.length === 0) return;

    const studentName = await resolveStudentDisplayName(input.studentUserId);
    const label = sessionLabel(input.session);
    const payload = attendanceMarkedNotificationPayload({
      studentName,
      status: input.status,
      sessionLabel: label,
      sessionId: input.session.id,
    });

    const inAppEnabled = await settingsService.isAbsenceAlertInAppEnabled();
    if (inAppEnabled) {
      await notifyUsers(
        guardianIds.map((userId) => ({
          userId,
          ...payload,
        })),
      );
    }

    if (input.status !== AttendanceStatus.ABSENT) return;

    const emailEnabled = await settingsService.isAbsenceAlertEmailEnabled();
    const smsEnabled = await settingsService.isAbsenceAlertSmsEnabled();
    if (!emailEnabled && !smsEnabled) return;

    const guardians = await AppDataSource.getRepository(User).find({
      where: { id: In(guardianIds) },
      select: { id: true, email: true, mobile: true, fullName: true },
    });

    const message = `${studentName} was marked absent for ${label}. If this is an error or ${studentName} is unwell, reply or open the app.`;

    if (emailEnabled) {
      const emailTargets = guardians.filter((g) => Boolean(g.email?.trim()));
      await mapPool(emailTargets, CHANNEL_CONCURRENCY, async (guardian) => {
        try {
          await emailService.sendAbsenceAlertEmail({
            to: guardian.email!.trim(),
            guardianName: guardian.fullName,
            studentFullName: studentName,
            sessionName: sessionNameOnly(input.session),
            sessionWhen: sessionWhenOnly(input.session),
            message,
          });
        } catch (error) {
          logger.warn(
            { err: error, guardianId: guardian.id },
            "Absence alert email failed",
          );
        }
      });
    }

    if (smsEnabled) {
      const smsTargets = guardians.filter((g) => Boolean(g.mobile?.trim()));
      const smsBody = `URGENT: ${studentName} marked absent for ${label}. Open the app if this is an error.`;
      await mapPool(smsTargets, CHANNEL_CONCURRENCY, async (guardian) => {
        try {
          await emailService.sendSessionChangeSms({
            to: guardian.mobile!.trim(),
            body: smsBody,
          });
        } catch (error) {
          logger.warn(
            { err: error, guardianId: guardian.id },
            "Absence alert SMS failed",
          );
        }
      });
    }
  } catch (error) {
    logger.warn(
      {
        err: error,
        sessionId: input.session.id,
        studentUserId: input.studentUserId,
      },
      "Failed to notify guardians of attendance mark",
    );
  }
}

export async function notifyGuardiansOfAttendanceCorrection(input: {
  session: Session;
  studentUserId: string;
  previousStatus: AttendanceStatus;
  newStatus: AttendanceStatus;
}): Promise<void> {
  if (
    input.previousStatus !== AttendanceStatus.ABSENT ||
    input.newStatus !== AttendanceStatus.PRESENT
  ) {
    return;
  }

  try {
    const guardiansByStudent = await resolveGuardianUserIdsForStudentUsers([
      input.studentUserId,
    ]);
    const guardianIds = [
      ...(guardiansByStudent.get(input.studentUserId) ?? []),
    ];
    if (guardianIds.length === 0) return;

    const studentName = await resolveStudentDisplayName(input.studentUserId);
    const payload = attendanceCorrectedNotificationPayload({
      studentName,
      sessionLabel: sessionLabel(input.session),
      sessionId: input.session.id,
    });

    await notifyUsers(
      guardianIds.map((userId) => ({
        userId,
        ...payload,
      })),
    );
  } catch (error) {
    logger.warn(
      {
        err: error,
        sessionId: input.session.id,
        studentUserId: input.studentUserId,
      },
      "Failed to notify guardians of attendance correction",
    );
  }
}

export async function notifyStaffOfAttendanceException(input: {
  session: Session;
  studentUserId: string;
  reasonFlagged: string;
}): Promise<void> {
  try {
    const studentName = await resolveStudentDisplayName(input.studentUserId);
    const label = sessionLabel(input.session);
    const teacherId =
      input.session.teacherId ??
      input.session.class?.teacher?.id ??
      input.session.assessment?.teacherId ??
      null;

    const officeStaff = await AppDataSource.getRepository(User).find({
      where: {
        role: In([UserRole.OFFICE_STAFF]),
        status: UserStatus.ACTIVE,
      },
      select: { id: true },
    });

    const recipientIds = new Set<string>();
    if (teacherId) recipientIds.add(teacherId);
    for (const staff of officeStaff) recipientIds.add(staff.id);
    if (recipientIds.size === 0) return;

    const inputs = [...recipientIds].map((userId) => {
      const isTutor = userId === teacherId;
      const tutorHref = input.session.classId
        ? `/tutor/classes/${input.session.classId}/roll/${input.session.id}`
        : `/tutor`;
      return {
        userId,
        ...attendanceExceptionNotificationPayload({
          studentName,
          sessionLabel: label,
          sessionId: input.session.id,
          reasonFlagged: input.reasonFlagged,
          href: isTutor ? tutorHref : `/admin/attendance`,
        }),
      };
    });

    await notifyUsers(inputs);
  } catch (error) {
    logger.warn(
      {
        err: error,
        sessionId: input.session.id,
        studentUserId: input.studentUserId,
      },
      "Failed to notify staff of attendance exception",
    );
  }
}
