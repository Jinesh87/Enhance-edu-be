import type { HolidayKind } from "../../entities/Holiday.js";

export type HolidayDateRange = {
  kind: HolidayKind;
  termId: string | null;
  startDate: string;
  endDate: string;
};

/** Inclusive YYYY-MM-DD check against public + term holidays for a term. */
export function isHolidayForTerm(
  date: string,
  termId: string,
  holidays: HolidayDateRange[],
): boolean {
  return holidays.some(
    (holiday) =>
      (holiday.kind === "PUBLIC" ||
        (holiday.kind === "TERM" && holiday.termId === termId)) &&
      date >= holiday.startDate &&
      date <= holiday.endDate,
  );
}

export function calendarDateFromDayTime(dayTime: string | null | undefined): string | null {
  if (!dayTime) return null;
  const datePart = dayTime.split("T")[0]?.trim();
  if (!datePart || !/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  return datePart;
}
