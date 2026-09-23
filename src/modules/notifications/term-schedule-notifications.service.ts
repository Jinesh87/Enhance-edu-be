import { randomUUID } from "crypto";
import { In } from "typeorm";
import { AppDataSource } from "../../config/data-source.js";
import { UserRole } from "../../common/constants/roles.js";
import { logger } from "../../config/logger.js";
import {
  DEFAULT_CLASS_TIMEZONE,
  formatInTimeZone,
} from "../../common/utils/timezone.js";
import {
  ClassStudent,
  ReminderDispatch,
  Session,
  Term,
  User,
} from "../../entities/index.js";
import { emailService } from "../email/email.service.js";
import { settingsService } from "../settings/settings.service.js";
import { resolveClassNotifyChannels } from "./class-notification-policy.js";
import {
  notificationsService,
  type CreateNotificationInput,
} from "./notifications.service.js";
import { resolveGuardianUserIdsForStudentUsers } from "./session-change-notifications.service.js";

const CHANNEL_CONCURRENCY = 5;
const MAX_EMAIL_SESSIONS = 80;
const MAX_SESSIONS_QUERY = 5000;
const KIND = "TERM_SCHEDULE";

type TimetableLine = { label: string; when: string; room: string };

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
  try {
    await AppDataSource.getRepository(ReminderDispatch).insert({
      dispatchKey,
      kind,
    });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    logger.warn({ err: error, dispatchKey }, "Term schedule dispatch claim failed");
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

function hrefForRole(role: string | null | undefined): string {
  if (role === UserRole.GUARDIAN) return "/guardian/students";
  if (role === UserRole.STUDENT) return "/student";
  return "/tutor";
}

function termLabel(term: Term): string {
  const year = term.academicYear?.year;
  const yearLevel = term.yearLevel?.name;
  if (year && yearLevel) return `${term.name} · ${year} · ${yearLevel}`;
  if (year) return `${term.name} · ${year}`;
  return term.name;
}

export class TermScheduleNotificationService {
  /**
   * After bulk term timetable publish: one consolidated in-app + email per
   * student / tutor / parent. Never one email per class/session.
   */
  async notifyTermSchedulePublished(termId: string): Promise<void> {
    try {
      await this.notifyUnsafe(termId);
    } catch (error) {
      logger.warn(
        { err: error, termId },
        "Failed to send term schedule notifications",
      );
    }
  }

  private async notifyUnsafe(termId: string): Promise<void> {
    const channels = resolveClassNotifyChannels({
      scenario: "term_schedule",
      sessionChangeEmailEnabled: false,
      urgentCancelSmsEnabled: false,
      termScheduleEmailEnabled:
        await settingsService.isTermScheduleEmailNotificationsEnabled(),
    });
    if (!channels.inApp && !channels.email) return;

    const term = await AppDataSource.getRepository(Term).findOne({
      where: { id: termId },
      relations: { academicYear: true, yearLevel: true },
    });
    if (!term) return;

    const label = termLabel(term);
    const termDateRange = `${term.startDate} – ${term.endDate}`;
    const runId = randomUUID();

    const sessions = await AppDataSource.getRepository(Session)
      .createQueryBuilder("s")
      .innerJoinAndSelect("s.class", "class")
      .leftJoinAndSelect("s.classroom", "classroom")
      .leftJoinAndSelect("class.classroom", "classClassroom")
      .leftJoinAndSelect("s.teacher", "teacher")
      .leftJoinAndSelect("class.teacher", "classTeacher")
      .where("class.termId = :termId", { termId })
      .andWhere("s.assessmentId IS NULL")
      .orderBy("s.startAt", "ASC")
      .take(MAX_SESSIONS_QUERY)
      .getMany();

    if (sessions.length === 0) return;

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
    const studentUserIds = new Set<string>();
    for (const row of roster) {
      const list = studentsByClass.get(row.classId) ?? [];
      list.push(row.studentId);
      studentsByClass.set(row.classId, list);
      studentUserIds.add(row.studentId);
    }

    const guardiansByStudent = await resolveGuardianUserIdsForStudentUsers(
      Array.from(studentUserIds),
    );

    const linesByUser = new Map<string, TimetableLine[]>();
    const seenByUser = new Map<string, Set<string>>();
    const pushLine = (userId: string | null | undefined, line: TimetableLine) => {
      if (!userId) return;
      const key = `${line.label}|${line.when}|${line.room}`;
      const seen = seenByUser.get(userId) ?? new Set<string>();
      if (seen.has(key)) return;
      seen.add(key);
      seenByUser.set(userId, seen);
      const list = linesByUser.get(userId) ?? [];
      list.push(line);
      linesByUser.set(userId, list);
    };

    for (const session of sessions) {
      const cls = session.class;
      if (!cls) continue;
      const timeZone = cls.timeZone || DEFAULT_CLASS_TIMEZONE;
      const room =
        session.room ||
        session.classroom?.name ||
        cls.room ||
        cls.classroom?.name ||
        "TBC";
      const line: TimetableLine = {
        label: cls.subject?.trim() || cls.name || "Class",
        when: formatSessionWhen(session.startAt, session.endAt, timeZone),
        room: room.trim() || "TBC",
      };

      const teacherId =
        session.teacher?.id ?? session.teacherId ?? cls.teacher?.id ?? null;
      pushLine(teacherId, line);

      const studentIds = studentsByClass.get(cls.id) ?? [];
      for (const studentId of studentIds) {
        pushLine(studentId, line);
        for (const guardianId of guardiansByStudent.get(studentId) ?? []) {
          pushLine(guardianId, line);
        }
      }
    }

    const userIds = Array.from(linesByUser.keys());
    if (userIds.length === 0) return;

    const users = await AppDataSource.getRepository(User).find({
      where: { id: In(userIds) },
      select: { id: true, email: true, fullName: true, role: true },
    });

    if (channels.inApp) {
      const inputs: CreateNotificationInput[] = [];
      for (const user of users) {
        const lines = linesByUser.get(user.id) ?? [];
        if (lines.length === 0) continue;
        const claimed = await claimDispatch(
          `term-schedule-inapp:${user.id}:${termId}:${runId}`,
          KIND,
        );
        if (!claimed) continue;
        inputs.push({
          userId: user.id,
          type: "TERM_SCHEDULE_PUBLISHED",
          title: `${label} timetable ready`,
          body: `Your schedule for ${label} is ready (${lines.length} session${lines.length === 1 ? "" : "s"}).`,
          data: {
            termId,
            termLabel: label,
            sessionCount: lines.length,
            href: hrefForRole(user.role),
          },
        });
      }
      // Chunk createMany to avoid huge single inserts
      const CHUNK = 40;
      for (let i = 0; i < inputs.length; i += CHUNK) {
        await notificationsService.createMany(inputs.slice(i, i + CHUNK));
      }
    }

    if (channels.email) {
      const emailTargets = users.filter((u) => Boolean(u.email?.trim()));
      await mapPool(emailTargets, CHANNEL_CONCURRENCY, async (user) => {
        const allLines = linesByUser.get(user.id) ?? [];
        if (allLines.length === 0) return;

        const claimed = await claimDispatch(
          `term-schedule-email:${user.id}:${termId}:${runId}`,
          KIND,
        );
        if (!claimed) return;

        const sessionsForEmail = allLines.slice(0, MAX_EMAIL_SESSIONS);
        const truncatedCount = Math.max(0, allLines.length - sessionsForEmail.length);

        try {
          await emailService.sendTermScheduleEmail({
            to: user.email!.trim(),
            fullName: user.fullName,
            termLabel: label,
            termDateRange,
            sessions: sessionsForEmail,
            truncatedCount,
          });
        } catch (error) {
          logger.warn(
            { err: error, userId: user.id, termId },
            "Term schedule email failed",
          );
        }
      });
    }

    logger.info(
      {
        termId,
        runId,
        recipientCount: userIds.length,
        sessionCount: sessions.length,
        emailed: channels.email,
      },
      "Term schedule notifications dispatched",
    );
  }
}

export const termScheduleNotificationService =
  new TermScheduleNotificationService();
