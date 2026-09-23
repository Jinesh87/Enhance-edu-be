import { In } from "typeorm";
import { AppDataSource } from "../../config/data-source.js";
import { UserRole } from "../../common/constants/roles.js";
import { logger } from "../../config/logger.js";
import {
  ClassStudent,
  Enrollment,
  Session,
  Student,
  User,
} from "../../entities/index.js";
import { emailService } from "../email/email.service.js";
import { settingsService } from "../settings/settings.service.js";
import {
  resolveClassNotifyChannels,
  resolveClassScheduleHref,
  resolveSessionChangeUrgency,
} from "./class-notification-policy.js";
import {
  notificationsService,
  type CreateNotificationInput,
} from "./notifications.service.js";

type SessionNotifyContext = {
  sessionId: string | null;
  classId: string;
  className: string;
  subject: string | null;
  startAt: Date;
  endAt: Date;
  room: string | null;
  teacherId: string | null;
  teacherName: string | null;
};

type SessionChangeKind = "SESSION_UPDATED" | "SESSION_DELETED";

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

function formatWhen(startAt: Date, endAt: Date) {
  const date = startAt.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const start = startAt.toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
  });
  const end = endAt.toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} · ${start} – ${end}`;
}

function buildMessages(
  kind: SessionChangeKind,
  ctx: SessionNotifyContext,
  previous?: { startAt: Date; endAt: Date; room: string | null } | null,
) {
  const label = ctx.subject?.trim() || ctx.className;
  const when = formatWhen(ctx.startAt, ctx.endAt);
  const room = ctx.room?.trim() || "TBC";

  if (kind === "SESSION_DELETED") {
    return {
      title: "Class session cancelled",
      body: `${label} on ${when} has been cancelled.`,
      smsBody: `URGENT: ${label} on ${when} (Room ${room}) has been cancelled. Do not travel to the centre.`,
    };
  }

  if (previous) {
    const prevWhen = formatWhen(previous.startAt, previous.endAt);
    const prevRoom = previous.room?.trim() || "TBC";
    if (prevWhen !== when || prevRoom !== room) {
      return {
        title: "Class session updated",
        body: `${label} changed from ${prevWhen} (${prevRoom}) to ${when} (${room}).`,
        smsBody: `URGENT: ${label} rescheduled to ${when}, Room ${room}.`,
      };
    }
  }

  return {
    title: "Class session updated",
    body: `${label} is now ${when} · Room ${room}.`,
    smsBody: `URGENT: ${label} is now ${when}, Room ${room}.`,
  };
}

export async function resolveGuardianUserIdsForStudentUsers(
  studentUserIds: string[],
): Promise<Map<string, Set<string>>> {
  const guardianIdsByStudentUser = new Map<string, Set<string>>();
  if (studentUserIds.length === 0) return guardianIdsByStudentUser;

  const students = await AppDataSource.getRepository(Student).find({
    where: { userId: In(studentUserIds) },
    relations: { guardianLinks: { guardian: true } },
  });

  const studentProfileIds = students.map((s) => s.id);
  const enrollments =
    studentProfileIds.length > 0
      ? await AppDataSource.getRepository(Enrollment).find({
          where: { studentId: In(studentProfileIds) },
          relations: { guardian: true },
        })
      : [];

  const enrollmentsByStudentProfile = new Map<string, Enrollment[]>();
  for (const enrollment of enrollments) {
    const list = enrollmentsByStudentProfile.get(enrollment.studentId) ?? [];
    list.push(enrollment);
    enrollmentsByStudentProfile.set(enrollment.studentId, list);
  }

  for (const student of students) {
    if (!student.userId) continue;
    const set = guardianIdsByStudentUser.get(student.userId) ?? new Set<string>();
    for (const link of student.guardianLinks ?? []) {
      if (link.guardian?.id) set.add(link.guardian.id);
    }
    for (const enrollment of enrollmentsByStudentProfile.get(student.id) ?? []) {
      if (enrollment.guardian?.id) set.add(enrollment.guardian.id);
    }
    guardianIdsByStudentUser.set(student.userId, set);
  }

  return guardianIdsByStudentUser;
}

export function sessionNotifyContextFromSession(
  session: Session,
): SessionNotifyContext | null {
  if (!session.classId) return null;
  const teacher = session.teacher ?? session.class?.teacher ?? null;
  return {
    sessionId: session.id,
    classId: session.classId,
    className: session.class?.name || "Class",
    subject: session.class?.subject ?? null,
    startAt: session.startAt,
    endAt: session.endAt,
    room:
      session.room ||
      session.classroom?.name ||
      session.class?.room ||
      session.class?.classroom?.name ||
      null,
    teacherId: teacher?.id ?? session.teacherId ?? session.class?.teacher?.id ?? null,
    teacherName: teacher?.fullName ?? null,
  };
}

export class SessionChangeNotificationService {
  async notifySessionChange(params: {
    kind: SessionChangeKind;
    context: SessionNotifyContext | null;
    previous?: { startAt: Date; endAt: Date; room: string | null } | null;
  }) {
    if (!params.context) return;
    try {
      await this.notifySessionChangeUnsafe({
        ...params,
        context: params.context,
      });
    } catch (error) {
      logger.warn(
        { err: error, kind: params.kind, classId: params.context.classId },
        "Failed to send session change notifications",
      );
    }
  }

  private async notifySessionChangeUnsafe(params: {
    kind: SessionChangeKind;
    context: SessionNotifyContext;
    previous?: { startAt: Date; endAt: Date; room: string | null } | null;
  }) {
    const { kind, context, previous } = params;
    const { title, body, smsBody } = buildMessages(kind, context, previous);

    const roster = await AppDataSource.getRepository(ClassStudent).find({
      where: { classId: context.classId },
      select: { studentId: true },
    });
    const studentUserIds = Array.from(
      new Set(roster.map((row) => row.studentId).filter(Boolean)),
    );

    const recipientIds = new Set<string>();
    if (context.teacherId) recipientIds.add(context.teacherId);
    for (const studentId of studentUserIds) recipientIds.add(studentId);

    // Cancel/reschedule always includes parents (product requirement).
    const guardiansByStudent =
      await resolveGuardianUserIdsForStudentUsers(studentUserIds);
    for (const guardianIds of guardiansByStudent.values()) {
      for (const guardianId of guardianIds) {
        recipientIds.add(guardianId);
      }
    }

    const recipientList = Array.from(recipientIds);
    if (recipientList.length === 0) return;

    const users = await AppDataSource.getRepository(User).find({
      where: { id: In(recipientList) },
      select: {
        id: true,
        email: true,
        mobile: true,
        fullName: true,
        role: true,
      },
    });

    const urgency = resolveSessionChangeUrgency(context.startAt);
    const channels = resolveClassNotifyChannels({
      scenario: kind === "SESSION_DELETED" ? "session_deleted" : "session_updated",
      urgency,
      sessionChangeEmailEnabled:
        await settingsService.isSessionChangeEmailNotificationsEnabled(),
      urgentCancelSmsEnabled: await settingsService.isUrgentCancelSmsEnabled(),
    });

    if (channels.inApp) {
      const inputs: CreateNotificationInput[] = users.map((user) => {
        const href = resolveClassScheduleHref(
          user.role,
          kind === "SESSION_DELETED" ? null : context.sessionId,
        );
        return {
          userId: user.id,
          type: kind,
          title,
          body,
          data: {
            sessionId: context.sessionId,
            classId: context.classId,
            className: context.className,
            subject: context.subject,
            startAt: context.startAt.toISOString(),
            endAt: context.endAt.toISOString(),
            room: context.room,
            urgency,
            href,
          },
        };
      });
      await notificationsService.createMany(inputs);
    }

    if (channels.email) {
      const emailTargets = users.filter((user) => Boolean(user.email?.trim()));
      await mapPool(emailTargets, CHANNEL_CONCURRENCY, async (user) => {
        try {
          await emailService.sendSessionChangeEmail({
            to: user.email!.trim(),
            fullName: user.fullName,
            title,
            body,
            sessionWhen: formatWhen(context.startAt, context.endAt),
            classLabel: context.subject?.trim() || context.className,
          });
        } catch (error) {
          logger.warn(
            { err: error, userId: user.id },
            "Session change email failed",
          );
        }
      });
    }

    if (channels.sms) {
      const smsTargets = users.filter((user) => Boolean(user.mobile?.trim()));
      await mapPool(smsTargets, CHANNEL_CONCURRENCY, async (user) => {
        try {
          await emailService.sendSessionChangeSms({
            to: user.mobile!.trim(),
            body: smsBody,
          });
        } catch (error) {
          logger.warn(
            { err: error, userId: user.id },
            "Session change SMS failed",
          );
        }
      });
    }
  }
}

export const sessionChangeNotificationService =
  new SessionChangeNotificationService();
