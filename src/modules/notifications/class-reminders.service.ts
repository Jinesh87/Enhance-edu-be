import { In } from "typeorm";
import { AppDataSource } from "../../config/data-source.js";
import { UserRole } from "../../common/constants/roles.js";
import { logger } from "../../config/logger.js";
import {
  ClassStudent,
  ReminderDispatch,
  Session,
  User,
} from "../../entities/index.js";
import {
  calendarDateInTimeZone,
  dayRangeInTimeZone,
  DEFAULT_CLASS_TIMEZONE,
  formatInTimeZone,
  zonedParts,
} from "../../common/utils/timezone.js";
import { emailService } from "../email/email.service.js";
import { settingsService } from "../settings/settings.service.js";
import {
  notificationsService,
  type CreateNotificationInput,
} from "./notifications.service.js";
import { resolveClassScheduleHref } from "./class-notification-policy.js";
import { sessionNotifyContextFromSession } from "./session-change-notifications.service.js";

const CHANNEL_CONCURRENCY = 5;
const REMINDER_1H_KIND = "SESSION_REMINDER_1H";
const DIGEST_KIND = "digest";
const DIGEST_SCAN_KIND = "digest-scan";

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
    logger.warn({ err: error, dispatchKey }, "Reminder dispatch claim failed");
    return false;
  }
}

function formatSessionWhen(startAt: Date, endAt: Date, timeZone: string) {
  const date = formatInTimeZone(startAt, timeZone, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const start = formatInTimeZone(startAt, timeZone, {
    hour: "numeric",
    minute: "2-digit",
  });
  const end = formatInTimeZone(endAt, timeZone, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} · ${start} – ${end}`;
}

function tomorrowDateKey(now: Date, timeZone: string): string {
  const parts = zonedParts(now, timeZone);
  const noonUtc = Date.UTC(parts.year, parts.month - 1, parts.day, 12);
  const tomorrow = new Date(noonUtc + 24 * 60 * 60 * 1000);
  return calendarDateInTimeZone(tomorrow, timeZone);
}

export class ClassRemindersService {
  async run1hScan(): Promise<{ scanned: number; sent: number }> {
    if (!(await settingsService.isClassReminder1hPushEnabled())) {
      return { scanned: 0, sent: 0 };
    }

    const now = Date.now();
    const windowStart = new Date(now + 55 * 60 * 1000);
    const windowEnd = new Date(now + 65 * 60 * 1000);

    const sessions = await AppDataSource.getRepository(Session)
      .createQueryBuilder("s")
      .leftJoinAndSelect("s.class", "class")
      .leftJoinAndSelect("s.classroom", "classroom")
      .leftJoinAndSelect("class.classroom", "classClassroom")
      .leftJoinAndSelect("s.teacher", "teacher")
      .leftJoinAndSelect("class.teacher", "classTeacher")
      .where("s.classId IS NOT NULL")
      .andWhere("s.assessmentId IS NULL")
      .andWhere("s.startAt >= :windowStart", { windowStart })
      .andWhere("s.startAt < :windowEnd", { windowEnd })
      .orderBy("s.startAt", "ASC")
      .take(500)
      .getMany();

    let sent = 0;
    for (const session of sessions) {
      const claimed = await claimDispatch(`1h:${session.id}`, REMINDER_1H_KIND);
      if (!claimed) continue;

      try {
        const notified = await this.send1hReminder(session);
        if (notified) sent += 1;
      } catch (error) {
        logger.warn(
          { err: error, sessionId: session.id },
          "1h class reminder failed",
        );
      }
    }

    return { scanned: sessions.length, sent };
  }

  private async send1hReminder(session: Session): Promise<boolean> {
    const ctx = sessionNotifyContextFromSession(session);
    if (!ctx) return false;

    const roster = await AppDataSource.getRepository(ClassStudent).find({
      where: { classId: ctx.classId },
      select: { studentId: true },
    });
    const recipientIds = new Set<string>();
    if (ctx.teacherId) recipientIds.add(ctx.teacherId);
    for (const row of roster) {
      if (row.studentId) recipientIds.add(row.studentId);
    }
    if (recipientIds.size === 0) return false;

    const users = await AppDataSource.getRepository(User).find({
      where: { id: In(Array.from(recipientIds)) },
      select: { id: true, role: true },
    });

    const label = ctx.subject?.trim() || ctx.className;
    const room = ctx.room?.trim() || "TBC";
    const when = formatSessionWhen(
      ctx.startAt,
      ctx.endAt,
      DEFAULT_CLASS_TIMEZONE,
    );
    const title = "Class starting in 1 hour";
    const body = `${label} starts at ${when} · Room ${room}.`;

    const inputs: CreateNotificationInput[] = users.map((user) => ({
      userId: user.id,
      type: "SESSION_REMINDER_1H",
      title,
      body,
      data: {
        sessionId: ctx.sessionId,
        classId: ctx.classId,
        className: ctx.className,
        subject: ctx.subject,
        startAt: ctx.startAt.toISOString(),
        endAt: ctx.endAt.toISOString(),
        room: ctx.room,
        href: resolveClassScheduleHref(user.role, ctx.sessionId),
      },
    }));

    await notificationsService.createMany(inputs);
    return true;
  }

  async runDigestScan(): Promise<{ claimed: boolean; emailed: number }> {
    if (!(await settingsService.isClassReminderDigestEnabled())) {
      return { claimed: false, emailed: 0 };
    }

    const timeZone = DEFAULT_CLASS_TIMEZONE;
    const now = new Date();
    const parts = zonedParts(now, timeZone);
    const digestHour = await settingsService.getClassReminderDigestHour();
    if (parts.hour !== digestHour) {
      return { claimed: false, emailed: 0 };
    }

    const todayKey = calendarDateInTimeZone(now, timeZone);
    const claimed = await claimDispatch(
      `digest-scan:${todayKey}`,
      DIGEST_SCAN_KIND,
    );
    if (!claimed) return { claimed: false, emailed: 0 };

    const tomorrowKey = tomorrowDateKey(now, timeZone);
    const [y, m, d] = tomorrowKey.split("-").map(Number);
    const tomorrowNoon = new Date(Date.UTC(y, m - 1, d, 12));
    const { start, end } = dayRangeInTimeZone(tomorrowNoon, timeZone);

    const sessions = await AppDataSource.getRepository(Session)
      .createQueryBuilder("s")
      .leftJoinAndSelect("s.class", "class")
      .leftJoinAndSelect("s.classroom", "classroom")
      .leftJoinAndSelect("class.classroom", "classClassroom")
      .leftJoinAndSelect("s.teacher", "teacher")
      .leftJoinAndSelect("class.teacher", "classTeacher")
      .where("s.classId IS NOT NULL")
      .andWhere("s.assessmentId IS NULL")
      .andWhere("s.startAt >= :start", { start })
      .andWhere("s.startAt < :end", { end })
      .orderBy("s.startAt", "ASC")
      .take(2000)
      .getMany();

    if (sessions.length === 0) return { claimed: true, emailed: 0 };

    const classIds = Array.from(
      new Set(sessions.map((s) => s.classId).filter(Boolean) as string[]),
    );
    const roster =
      classIds.length > 0
        ? await AppDataSource.getRepository(ClassStudent).find({
            where: { classId: In(classIds) },
            select: { classId: true, studentId: true },
          })
        : [];

    const studentsByClass = new Map<string, string[]>();
    for (const row of roster) {
      const list = studentsByClass.get(row.classId) ?? [];
      list.push(row.studentId);
      studentsByClass.set(row.classId, list);
    }

    type DigestLine = { label: string; when: string; room: string };
    const linesByUser = new Map<string, DigestLine[]>();

    const pushLine = (userId: string | null | undefined, line: DigestLine) => {
      if (!userId) return;
      const list = linesByUser.get(userId) ?? [];
      list.push(line);
      linesByUser.set(userId, list);
    };

    for (const session of sessions) {
      const ctx = sessionNotifyContextFromSession(session);
      if (!ctx) continue;
      const line: DigestLine = {
        label: ctx.subject?.trim() || ctx.className,
        when: formatSessionWhen(ctx.startAt, ctx.endAt, timeZone),
        room: ctx.room?.trim() || "TBC",
      };
      pushLine(ctx.teacherId, line);
      for (const studentId of studentsByClass.get(ctx.classId) ?? []) {
        pushLine(studentId, line);
      }
    }

    const userIds = Array.from(linesByUser.keys());
    if (userIds.length === 0) return { claimed: true, emailed: 0 };

    const users = await AppDataSource.getRepository(User).find({
      where: { id: In(userIds) },
      select: { id: true, email: true, fullName: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    const digestDateLabel = formatInTimeZone(start, timeZone, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    let emailed = 0;
    await mapPool(userIds, CHANNEL_CONCURRENCY, async (userId) => {
      const user = userById.get(userId);
      const email = user?.email?.trim();
      if (!user || !email) return;

      const claimedUser = await claimDispatch(
        `digest:${userId}:${tomorrowKey}`,
        DIGEST_KIND,
      );
      if (!claimedUser) return;

      const sessionsForUser = linesByUser.get(userId) ?? [];
      if (sessionsForUser.length === 0) return;

      try {
        await emailService.sendClassDigestEmail({
          to: email,
          fullName: user.fullName,
          digestDateLabel,
          sessions: sessionsForUser,
        });
        emailed += 1;
      } catch (error) {
        logger.warn({ err: error, userId }, "Class digest email failed");
      }
    });

    return { claimed: true, emailed };
  }
}

export const classRemindersService = new ClassRemindersService();
