import {
  calendarDateInTimeZone,
  dayRangeInTimeZone,
  DEFAULT_CLASS_TIMEZONE,
  zonedWallTimeToUtc,
} from "./timezone.js";

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function weekdayIndexInZone(date: Date, timeZone: string): number {
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(date);
  return WEEKDAY_INDEX[label] ?? 0;
}

export function addCalendarDays(
  dateKey: string,
  days: number,
  timeZone: string = DEFAULT_CLASS_TIMEZONE,
): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const anchor = zonedWallTimeToUtc(
    { year, month, day, hour: 12, minute: 0, second: 0 },
    timeZone,
  );
  const shifted = new Date(anchor.getTime() + days * 86_400_000);
  return calendarDateInTimeZone(shifted, timeZone);
}

export function sundayOfWeekContaining(
  dateKey: string,
  timeZone: string = DEFAULT_CLASS_TIMEZONE,
): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const anchor = zonedWallTimeToUtc(
    { year, month, day, hour: 12, minute: 0, second: 0 },
    timeZone,
  );
  const dow = weekdayIndexInZone(anchor, timeZone);
  const daysToSunday = dow === 0 ? 0 : 7 - dow;
  return addCalendarDays(dateKey, daysToSunday, timeZone);
}

export function dayStartUtc(
  dateKey: string,
  timeZone: string = DEFAULT_CLASS_TIMEZONE,
): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return zonedWallTimeToUtc(
    { year, month, day, hour: 0, minute: 0, second: 0 },
    timeZone,
  );
}

export function dayEndUtc(
  dateKey: string,
  timeZone: string = DEFAULT_CLASS_TIMEZONE,
): Date {
  const nextKey = addCalendarDays(dateKey, 1, timeZone);
  return new Date(dayStartUtc(nextKey, timeZone).getTime() - 1);
}

export type TeacherUpcomingRanges = {
  todayStart: Date;
  todayEnd: Date;
  thisWeekStart: Date;
  thisWeekEnd: Date;
  nextWeekStart: Date;
  nextWeekEnd: Date;
  nextExtraWeekStart: string;
};

export function buildTeacherUpcomingRanges(
  now = new Date(),
  timeZone: string = DEFAULT_CLASS_TIMEZONE,
): TeacherUpcomingRanges {
  const todayRange = dayRangeInTimeZone(now, timeZone);
  const todayKey = calendarDateInTimeZone(now, timeZone);
  const sundayThisWeek = sundayOfWeekContaining(todayKey, timeZone);
  const mondayNextWeek = addCalendarDays(sundayThisWeek, 1, timeZone);
  const sundayNextWeek = addCalendarDays(mondayNextWeek, 6, timeZone);
  const mondayAfterNext = addCalendarDays(sundayNextWeek, 1, timeZone);

  return {
    todayStart: todayRange.start,
    todayEnd: new Date(todayRange.end.getTime() - 1),
    thisWeekStart: todayRange.end,
    thisWeekEnd: dayEndUtc(sundayThisWeek, timeZone),
    nextWeekStart: dayStartUtc(mondayNextWeek, timeZone),
    nextWeekEnd: dayEndUtc(sundayNextWeek, timeZone),
    nextExtraWeekStart: mondayAfterNext,
  };
}

export function weekRangeFromMondayStart(
  weekStartKey: string,
  timeZone: string = DEFAULT_CLASS_TIMEZONE,
): { start: Date; end: Date; weekEndKey: string } {
  const weekEndKey = addCalendarDays(weekStartKey, 6, timeZone);
  return {
    start: dayStartUtc(weekStartKey, timeZone),
    end: dayEndUtc(weekEndKey, timeZone),
    weekEndKey,
  };
}
