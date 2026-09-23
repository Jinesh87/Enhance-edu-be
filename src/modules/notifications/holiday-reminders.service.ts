import { In } from "typeorm";
import { UserRole } from "../../common/constants/roles.js";
import { expandDateRange } from "../../common/utils/class-session-purge.js";
import {
  calendarDateInTimeZone,
  DEFAULT_CLASS_TIMEZONE,
} from "../../common/utils/timezone.js";
import { AppDataSource } from "../../config/data-source.js";
import { logger } from "../../config/logger.js";
import {
  Class,
  ClassStudent,
  Holiday,
  ReminderDispatch,
  User,
} from "../../entities/index.js";
import { emailService } from "../email/email.service.js";
import { settingsService } from "../settings/settings.service.js";
import {
  holidayReminderNotificationPayload,
  notifyUsers,
} from "./domain-notifications.js";
import { resolveGuardianUserIdsForStudentUsers } from "./session-change-notifications.service.js";

const CHANNEL_CONCURRENCY = 5;
const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

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
    logger.warn({ err: error, dispatchKey }, "Holiday reminder claim failed");
    return false;
  }
}

function addCalendarDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const noon = new Date(Date.UTC(y!, m! - 1, d!, 12));
  noon.setUTCDate(noon.getUTCDate() + days);
  return noon.toISOString().slice(0, 10);
}

function weekdayNameFromYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return WEEKDAY_NAMES[
    new Date(Date.UTC(y!, m! - 1, d!, 12)).getUTCDay()
  ]!;
}

function classWeekdayFromDayTime(dayTime: string | null): string | null {
  if (!dayTime) return null;
  const isoPart = dayTime.split(" ")[0]?.trim() ?? "";
  const datePart = isoPart.includes("T") ? isoPart.split("T")[0]! : isoPart;
  const [yearStr, monthStr, dayStr] = datePart.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!year || !month || !day) return null;
  const dayName =
    WEEKDAY_NAMES[new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay()];
  if (
    dayName !== "Monday" &&
    dayName !== "Tuesday" &&
    dayName !== "Wednesday" &&
    dayName !== "Thursday" &&
    dayName !== "Friday"
  ) {
    return null;
  }
  return dayName;
}

function formatHolidayDateLabel(startDate: string, endDate: string): string {
  const start = String(startDate).slice(0, 10);
  const end = String(endDate).slice(0, 10);
  if (start === end) return start;
  return `${start} – ${end}`;
}

function hrefForRole(role: string | null | undefined): string {
  if (role === UserRole.GUARDIAN) return "/guardian/students";
  if (role === UserRole.STUDENT) return "/student";
  return "/tutor";
}

async function resolveAffectedUserIds(holiday: Holiday): Promise<string[]> {
  const holidayDates = expandDateRange(
    String(holiday.startDate).slice(0, 10),
    String(holiday.endDate).slice(0, 10),
  );
  const holidayWeekdays = new Set(holidayDates.map(weekdayNameFromYmd));

  const classRepo = AppDataSource.getRepository(Class);
  let classes: Class[];
  if (holiday.kind === "TERM" && holiday.termId) {
    classes = await classRepo.find({
      where: { term: { id: holiday.termId } },
      relations: { teacher: true, term: true },
    });
  } else {
    classes = await classRepo.find({
      relations: { teacher: true, term: true },
    });
  }

  const affectedClassIds: string[] = [];
  const teacherIds = new Set<string>();
  for (const cls of classes) {
    if (!cls.term) continue;
    const classWd = classWeekdayFromDayTime(cls.dayTime);
    if (!classWd || !holidayWeekdays.has(classWd)) continue;
    affectedClassIds.push(cls.id);
    const teacherId =
      cls.teacher?.id ??
      (cls as Class & { teacherId?: string | null }).teacherId ??
      null;
    if (teacherId) teacherIds.add(teacherId);
  }

  if (affectedClassIds.length === 0 && teacherIds.size === 0) return [];

  const studentUserIds = new Set<string>();
  if (affectedClassIds.length > 0) {
    const roster = await AppDataSource.getRepository(ClassStudent).find({
      where: { classId: In(affectedClassIds) },
      select: { studentId: true },
    });
    for (const row of roster) {
      if (row.studentId) studentUserIds.add(row.studentId);
    }
  }

  const guardiansByStudent = await resolveGuardianUserIdsForStudentUsers([
    ...studentUserIds,
  ]);
  const guardianIds = new Set<string>();
  for (const set of guardiansByStudent.values()) {
    for (const id of set) guardianIds.add(id);
  }

  return [
    ...new Set([...studentUserIds, ...teacherIds, ...guardianIds]),
  ];
}

export class HolidayRemindersService {
  async runUpcomingScan(): Promise<{ scanned: number; sent: number }> {
    const inAppEnabled = await settingsService.isHolidayReminderInAppEnabled();
    const emailEnabled = await settingsService.isHolidayReminderEmailEnabled();
    if (!inAppEnabled && !emailEnabled) {
      return { scanned: 0, sent: 0 };
    }

    const timeZone = DEFAULT_CLASS_TIMEZONE;
    const todayKey = calendarDateInTimeZone(new Date(), timeZone);
    const leadTargets: Array<{ leadDays: 7 | 2; targetStart: string }> = [
      { leadDays: 7, targetStart: addCalendarDays(todayKey, 7) },
      { leadDays: 2, targetStart: addCalendarDays(todayKey, 2) },
    ];

    let scanned = 0;
    let sent = 0;

    for (const { leadDays, targetStart } of leadTargets) {
      const holidaysQb = await AppDataSource.getRepository(Holiday)
        .createQueryBuilder("h")
        .where('h."startDate" = :targetStart', { targetStart })
        .getMany();

      scanned += holidaysQb.length;

      for (const holiday of holidaysQb) {
        const userIds = await resolveAffectedUserIds(holiday);
        if (userIds.length === 0) continue;

        const users = await AppDataSource.getRepository(User).find({
          where: { id: In(userIds) },
          select: { id: true, email: true, fullName: true, role: true },
        });

        const dateLabel = formatHolidayDateLabel(
          String(holiday.startDate),
          String(holiday.endDate),
        );
        const kind = leadDays === 7 ? "HOLIDAY_1W" : "HOLIDAY_2D";
        const leadKey = leadDays === 7 ? "1w" : "2d";

        const notifyBatch: Array<{
          userId: string;
          type: ReturnType<typeof holidayReminderNotificationPayload>["type"];
          title: string;
          body: string;
          data: ReturnType<typeof holidayReminderNotificationPayload>["data"];
        }> = [];
        const emailTargets: User[] = [];

        for (const user of users) {
          const claimed = await claimDispatch(
            `holiday-${leadKey}:${holiday.id}:${user.id}`,
            kind,
          );
          if (!claimed) continue;

          if (inAppEnabled) {
            const payload = holidayReminderNotificationPayload({
              holidayId: holiday.id,
              holidayName: holiday.name,
              dateLabel,
              leadDays,
              href: hrefForRole(user.role),
            });
            notifyBatch.push({
              userId: user.id,
              type: payload.type,
              title: payload.title,
              body: payload.body,
              data: payload.data,
            });
          }

          if (emailEnabled && user.email?.trim()) {
            emailTargets.push(user);
          }
          sent += 1;
        }

        if (notifyBatch.length > 0) {
          await notifyUsers(notifyBatch);
        }

        await mapPool(emailTargets, CHANNEL_CONCURRENCY, async (user) => {
          try {
            await emailService.sendHolidayReminderEmail({
              to: user.email!.trim(),
              fullName: user.fullName?.trim() || "there",
              holidayName: holiday.name,
              dateLabel,
              leadDays,
            });
          } catch (error) {
            logger.warn(
              { err: error, userId: user.id, holidayId: holiday.id },
              "Holiday reminder email failed",
            );
          }
        });
      }
    }

    return { scanned, sent };
  }
}

export const holidayRemindersService = new HolidayRemindersService();
