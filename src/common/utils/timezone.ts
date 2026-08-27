import { env } from "../../config/env.js";

export const DEFAULT_CLASS_TIMEZONE = env.APP_TIMEZONE;

export type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second?: number;
};

export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function resolveIanaTimeZone(timeZone?: string | null): string {
  const tz = timeZone?.trim();
  if (tz && isValidTimeZone(tz)) return tz;
  return DEFAULT_CLASS_TIMEZONE;
}

export function getBrowserTimeZone(): string {
  return resolveIanaTimeZone(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
}

function zonedParts(date: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "0";

  let hour = Number(value("hour"));
  if (hour === 24) hour = 0;

  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    hour,
    minute: Number(value("minute")),
    second: Number(value("second")),
  };
}

function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second ?? 0,
  );
  return asUtc - date.getTime();
}

export function zonedWallTimeToUtc(
  wall: WallClock,
  timeZone?: string | null,
): Date {
  const tz = resolveIanaTimeZone(timeZone);
  const utcGuess = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second ?? 0,
  );
  const first = utcGuess - tzOffsetMs(new Date(utcGuess), tz);
  const second = utcGuess - tzOffsetMs(new Date(first), tz);
  return new Date(second);
}

export function calendarDateInTimeZone(
  date: Date,
  timeZone?: string | null,
): string {
  const parts = zonedParts(date, resolveIanaTimeZone(timeZone));
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${parts.year}-${month}-${day}`;
}

export function dayRangeInTimeZone(
  date: Date,
  timeZone?: string | null,
): { start: Date; end: Date } {
  const tz = resolveIanaTimeZone(timeZone);
  const dateKey = calendarDateInTimeZone(date, tz);
  const [year, month, day] = dateKey.split("-").map(Number);
  const start = zonedWallTimeToUtc(
    { year, month, day, hour: 0, minute: 0, second: 0 },
    tz,
  );
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1, 12));
  const nextDateKey = calendarDateInTimeZone(nextDay, "UTC");
  const [nextYear, nextMonth, nextDayOfMonth] = nextDateKey
    .split("-")
    .map(Number);
  const end = zonedWallTimeToUtc(
    {
      year: nextYear,
      month: nextMonth,
      day: nextDayOfMonth,
      hour: 0,
      minute: 0,
      second: 0,
    },
    tz,
  );
  return { start, end };
}

export function formatInTimeZone(
  value: string | Date,
  timeZone?: string | null,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-AU", {
    timeZone: resolveIanaTimeZone(timeZone),
    ...options,
  });
}

export function parseWallClockFromDayTime(
  dayTime: string | null | undefined,
): { start: WallClock; end: { hour: number; minute: number } | null } | null {
  if (!dayTime?.trim()) return null;
  const [startRaw, endRaw] = dayTime.trim().split(/\s+/);
  const match = startRaw.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/,
  );
  if (!match) return null;

  const start: WallClock = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
  };

  let end: { hour: number; minute: number } | null = null;
  if (endRaw && /^\d{1,2}:\d{2}/.test(endRaw)) {
    const [hours, minutes] = endRaw.split(":").map(Number);
    end = { hour: hours, minute: minutes };
  }

  return { start, end };
}

export function parseDayTime(
  dayTime: string | null | undefined,
  timeZone?: string | null,
  fallbackEndMinutes = 60,
): { startAt: Date; endAt: Date } | null {
  const parsed = parseWallClockFromDayTime(dayTime);
  if (!parsed) return null;

  const startAt = zonedWallTimeToUtc(parsed.start, timeZone);
  if (Number.isNaN(startAt.getTime())) return null;

  if (parsed.end) {
    const endAt = zonedWallTimeToUtc(
      {
        ...parsed.start,
        hour: parsed.end.hour,
        minute: parsed.end.minute,
        second: 0,
      },
      timeZone,
    );
    if (endAt.getTime() <= startAt.getTime()) {
      return {
        startAt,
        endAt: new Date(startAt.getTime() + fallbackEndMinutes * 60_000),
      };
    }
    return { startAt, endAt };
  }

  return {
    startAt,
    endAt: new Date(startAt.getTime() + fallbackEndMinutes * 60_000),
  };
}
