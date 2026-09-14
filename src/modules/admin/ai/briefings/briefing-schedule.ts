import {
  calendarDateInTimeZone,
  resolveIanaTimeZone,
  zonedWallTimeToUtc,
  type WallClock,
} from "../../../../common/utils/timezone.js";
import type { AdminAiBriefingConfig } from "../admin-ai-capabilities.js";

const WEEKDAY_TO_NUM: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function weekdayInTimeZone(date: Date, timeZone: string): number {
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(date);
  return WEEKDAY_TO_NUM[label] ?? 0;
}

function parseHm(time: string | null | undefined): { hour: number; minute: number } {
  const raw = (time ?? "08:00").trim();
  const match = /^(\d{2}):(\d{2})$/.exec(raw);
  if (!match) return { hour: 8, minute: 0 };
  const hour = Math.min(23, Math.max(0, Number(match[1])));
  const minute = Math.min(59, Math.max(0, Number(match[2])));
  return { hour, minute };
}

function inOptionalDateRange(
  localDate: string,
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): boolean {
  if (startDate && localDate < startDate) return false;
  if (endDate && localDate > endDate) return false;
  return true;
}

/** Next UTC fire time from `from` (exclusive), DST-safe via IANA zone. */
export function computeNextBriefingRunAt(
  config: AdminAiBriefingConfig,
  from: Date = new Date(),
): Date | null {
  const tz = resolveIanaTimeZone(config.timeZone);
  const days = config.daysOfWeek?.length ? config.daysOfWeek : [1, 2, 3, 4, 5];
  const { hour, minute } = parseHm(config.time);

  for (let offset = 0; offset < 21; offset += 1) {
    const probe = new Date(from.getTime() + offset * 24 * 60 * 60 * 1000);
    const localDate = calendarDateInTimeZone(probe, tz);
    const [year, month, day] = localDate.split("-").map(Number);
    const noonUtc = Date.UTC(year, month - 1, day, 12, 0, 0);
    const weekday = weekdayInTimeZone(new Date(noonUtc), tz);
    if (!days.includes(weekday)) continue;
    if (!inOptionalDateRange(localDate, config.startDate, config.endDate)) {
      continue;
    }

    const wall: WallClock = { year, month, day, hour, minute, second: 0 };
    const utc = zonedWallTimeToUtc(wall, tz);
    if (utc.getTime() > from.getTime()) {
      return utc;
    }
  }

  return null;
}

export function localBriefingDateForRun(
  runAt: Date,
  timeZone?: string | null,
): string {
  return calendarDateInTimeZone(runAt, resolveIanaTimeZone(timeZone));
}
