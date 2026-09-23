import { In } from "typeorm";
import { AppDataSource } from "../../config/data-source.js";
import { logger } from "../../config/logger.js";
import {
  calendarDateInTimeZone,
  DEFAULT_CLASS_TIMEZONE,
  zonedParts,
} from "../../common/utils/timezone.js";
import {
  HomeworkStudent,
  ReminderDispatch,
  User,
} from "../../entities/index.js";
import { emailService } from "../email/email.service.js";
import { settingsService } from "../settings/settings.service.js";
import {
  homeworkDueSoonNotificationPayload,
  homeworkOverdueNotificationPayload,
  notifyUsers,
} from "./domain-notifications.js";
import { resolveGuardianUserIdsForStudentUsers } from "./session-change-notifications.service.js";

const CHANNEL_CONCURRENCY = 5;
const HW_DUE_KIND = "HOMEWORK_DUE_SOON";
const HW_OVERDUE_KIND = "HOMEWORK_OVERDUE";

type PendingHomeworkRow = {
  homeworkId: string;
  studentId: string;
  title: string;
  dueDate: string;
  subjectName: string;
};

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
    logger.warn({ err: error, dispatchKey }, "Homework reminder claim failed");
    return false;
  }
}

function yesterdayDateKey(now: Date, timeZone: string): string {
  const parts = zonedParts(now, timeZone);
  const noonUtc = Date.UTC(parts.year, parts.month - 1, parts.day, 12);
  const yesterday = new Date(noonUtc - 24 * 60 * 60 * 1000);
  return calendarDateInTimeZone(yesterday, timeZone);
}

function normalizeDueDate(value: string | Date): string {
  return String(value).slice(0, 10);
}

async function loadPendingHomeworkForDueDate(
  dueDateKey: string,
): Promise<PendingHomeworkRow[]> {
  const rows = await AppDataSource.getRepository(HomeworkStudent)
    .createQueryBuilder("hs")
    .innerJoin("hs.homework", "h")
    .innerJoin("h.subject", "subject")
    .leftJoin(
      "homework_submissions",
      "sub",
      "sub.\"homeworkId\" = hs.\"homeworkId\" AND sub.\"studentId\" = hs.\"studentId\"",
    )
    .where("h.\"dueDate\" = :dueDateKey", { dueDateKey })
    .andWhere("(sub.id IS NULL OR sub.status <> :submitted)", {
      submitted: "SUBMITTED",
    })
    .select([
      "hs.homeworkId AS \"homeworkId\"",
      "hs.studentId AS \"studentId\"",
      "h.title AS title",
      "h.dueDate AS \"dueDate\"",
      "subject.name AS \"subjectName\"",
    ])
    .getRawMany<{
      homeworkId: string;
      studentId: string;
      title: string;
      dueDate: string | Date;
      subjectName: string;
    }>();

  return rows.map((row) => ({
    homeworkId: row.homeworkId,
    studentId: row.studentId,
    title: row.title,
    dueDate: normalizeDueDate(row.dueDate),
    subjectName: row.subjectName?.trim() || "Subject",
  }));
}

async function resolveStudentNames(
  studentIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(studentIds)];
  if (unique.length === 0) return new Map();
  const users = await AppDataSource.getRepository(User).find({
    where: { id: In(unique) },
    select: { id: true, fullName: true, preferredName: true },
  });
  const map = new Map<string, string>();
  for (const user of users) {
    map.set(
      user.id,
      user.preferredName?.trim() || user.fullName?.trim() || "Student",
    );
  }
  return map;
}

export class HomeworkRemindersService {
  async runDueSoonScan(): Promise<{ scanned: number; sent: number }> {
    if (!(await settingsService.isHomeworkDueSoonEnabled())) {
      return { scanned: 0, sent: 0 };
    }

    const timeZone = DEFAULT_CLASS_TIMEZONE;
    const todayKey = calendarDateInTimeZone(new Date(), timeZone);
    const candidates = await loadPendingHomeworkForDueDate(todayKey);

    let sent = 0;
    const notifyBatch: Array<{
      userId: string;
      type: ReturnType<typeof homeworkDueSoonNotificationPayload>["type"];
      title: string;
      body: string;
      data: ReturnType<typeof homeworkDueSoonNotificationPayload>["data"];
    }> = [];

    for (const row of candidates) {
      const claimed = await claimDispatch(
        `hw-due:${row.homeworkId}:${row.studentId}`,
        HW_DUE_KIND,
      );
      if (!claimed) continue;

      const payload = homeworkDueSoonNotificationPayload({
        homeworkId: row.homeworkId,
        title: row.title,
        subjectName: row.subjectName,
        dueDate: row.dueDate,
      });
      notifyBatch.push({
        userId: row.studentId,
        type: payload.type,
        title: payload.title,
        body: payload.body,
        data: payload.data,
      });
      sent += 1;
    }

    if (notifyBatch.length > 0) {
      await notifyUsers(notifyBatch);
    }

    return { scanned: candidates.length, sent };
  }

  async runOverdueScan(): Promise<{ scanned: number; sent: number }> {
    const inAppEnabled =
      await settingsService.isHomeworkOverdueInAppEnabled();
    const emailEnabled =
      await settingsService.isHomeworkOverdueEmailEnabled();
    if (!inAppEnabled && !emailEnabled) {
      return { scanned: 0, sent: 0 };
    }

    const timeZone = DEFAULT_CLASS_TIMEZONE;
    const yesterdayKey = yesterdayDateKey(new Date(), timeZone);
    const candidates = await loadPendingHomeworkForDueDate(yesterdayKey);

    let sent = 0;
    const studentNames = await resolveStudentNames(
      candidates.map((c) => c.studentId),
    );

    for (const row of candidates) {
      const claimed = await claimDispatch(
        `hw-overdue:${row.homeworkId}:${row.studentId}`,
        HW_OVERDUE_KIND,
      );
      if (!claimed) continue;

      const studentName = studentNames.get(row.studentId) || "Student";
      const guardiansByStudent = await resolveGuardianUserIdsForStudentUsers([
        row.studentId,
      ]);
      const guardianIds = [
        ...(guardiansByStudent.get(row.studentId) ?? []),
      ];

      if (inAppEnabled) {
        const studentPayload = homeworkOverdueNotificationPayload({
          homeworkId: row.homeworkId,
          title: row.title,
          subjectName: row.subjectName,
          dueDate: row.dueDate,
        });
        const notifyInputs = [
          {
            userId: row.studentId,
            type: studentPayload.type,
            title: studentPayload.title,
            body: studentPayload.body,
            data: studentPayload.data,
          },
          ...guardianIds.map((guardianId) => {
            const payload = homeworkOverdueNotificationPayload({
              homeworkId: row.homeworkId,
              title: row.title,
              subjectName: row.subjectName,
              dueDate: row.dueDate,
              studentName,
              forGuardian: true,
            });
            return {
              userId: guardianId,
              type: payload.type,
              title: payload.title,
              body: payload.body,
              data: payload.data,
            };
          }),
        ];
        await notifyUsers(notifyInputs);
      }

      if (emailEnabled && guardianIds.length > 0) {
        const guardians = await AppDataSource.getRepository(User).find({
          where: { id: In(guardianIds) },
          select: { id: true, email: true, fullName: true },
        });
        const emailTargets = guardians.filter((g) => Boolean(g.email?.trim()));
        await mapPool(emailTargets, CHANNEL_CONCURRENCY, async (guardian) => {
          try {
            await emailService.sendHomeworkOverdueEmail({
              to: guardian.email!.trim(),
              guardianName: guardian.fullName?.trim() || "Parent",
              studentFullName: studentName,
              homeworkTitle: row.title,
              subjectName: row.subjectName,
              dueDate: row.dueDate,
            });
          } catch (error) {
            logger.warn(
              {
                err: error,
                guardianId: guardian.id,
                homeworkId: row.homeworkId,
              },
              "Homework overdue email failed",
            );
          }
        });
      }

      sent += 1;
    }

    return { scanned: candidates.length, sent };
  }
}

export const homeworkRemindersService = new HomeworkRemindersService();
