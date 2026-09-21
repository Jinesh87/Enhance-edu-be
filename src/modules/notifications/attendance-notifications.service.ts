import { In } from "typeorm";
import { UserRole, UserStatus } from "../../common/constants/roles.js";
import { AppDataSource } from "../../config/data-source.js";
import { logger } from "../../config/logger.js";
import {
  AttendanceStatus,
  Session,
  User,
} from "../../entities/index.js";
import {
  attendanceExceptionNotificationPayload,
  attendanceMarkedNotificationPayload,
  notifyUsers,
} from "./domain-notifications.js";
import { resolveGuardianUserIdsForStudentUsers } from "./session-change-notifications.service.js";

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
    const payload = attendanceMarkedNotificationPayload({
      studentName,
      status: input.status,
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
      { err: error, sessionId: input.session.id, studentUserId: input.studentUserId },
      "Failed to notify guardians of attendance mark",
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
