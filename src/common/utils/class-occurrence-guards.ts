import { In } from "typeorm";
import { AppDataSource } from "../../config/data-source.js";
import { Assessment } from "../../entities/Assessment.js";
import { Holiday } from "../../entities/Holiday.js";
import {
  calendarDateFromDayTime,
  isHolidayForTerm,
  type HolidayDateRange,
} from "./holidays.js";
import {
  calendarDateInTimeZone,
  DEFAULT_CLASS_TIMEZONE,
  parseDayTime,
  resolveIanaTimeZone,
} from "./timezone.js";

export type ClassOccurrenceBlockers = {
  holidays: HolidayDateRange[];
  fullDayDatesByTerm: Map<string, Set<string>>;
};

/**
 * Dates (YYYY-MM-DD) where class sessions must not be created for a term:
 * public/term holidays + active FULL_DAY school assessments.
 */
export async function loadClassOccurrenceBlockers(
  termIds: string[],
): Promise<ClassOccurrenceBlockers> {
  const uniqueTermIds = [...new Set(termIds.filter(Boolean))];
  const holidayRepo = AppDataSource.getRepository(Holiday);
  const assessmentRepo = AppDataSource.getRepository(Assessment);

  const [holidays, fullDayAssessments] = await Promise.all([
    uniqueTermIds.length > 0
      ? holidayRepo.find({
          where: [
            { kind: "PUBLIC" },
            { kind: "TERM", termId: In(uniqueTermIds) },
          ],
        })
      : holidayRepo.find({ where: { kind: "PUBLIC" } }),
    uniqueTermIds.length > 0
      ? assessmentRepo.find({
          where: {
            termId: In(uniqueTermIds),
            scheduleType: "FULL_DAY",
            status: In(["SCHEDULED", "LIVE", "COMPLETED"]),
          },
          select: { termId: true, assessmentDate: true },
        })
      : Promise.resolve([]),
  ]);

  const holidayRanges: HolidayDateRange[] = holidays.map((h) => ({
    kind: h.kind,
    termId: h.termId,
    startDate: String(h.startDate).slice(0, 10),
    endDate: String(h.endDate).slice(0, 10),
  }));

  const fullDayDatesByTerm = new Map<string, Set<string>>();
  for (const row of fullDayAssessments) {
    const dateKey = String(row.assessmentDate).slice(0, 10);
    const set = fullDayDatesByTerm.get(row.termId) ?? new Set<string>();
    set.add(dateKey);
    fullDayDatesByTerm.set(row.termId, set);
  }

  return { holidays: holidayRanges, fullDayDatesByTerm };
}

export function resolveClassOccurrenceDateKey(
  dayTime: string | null | undefined,
  timeZone: string | null | undefined,
): string | null {
  const fromDayTime = calendarDateFromDayTime(dayTime);
  if (fromDayTime) return fromDayTime;

  const times = parseDayTime(dayTime ?? null, timeZone);
  if (!times) return null;
  return calendarDateInTimeZone(
    times.startAt,
    resolveIanaTimeZone(timeZone) || DEFAULT_CLASS_TIMEZONE,
  );
}

export function isClassOccurrenceBlocked(
  dateKey: string | null,
  termId: string | null | undefined,
  blockers: ClassOccurrenceBlockers,
): boolean {
  if (!dateKey || !termId) return false;
  if (isHolidayForTerm(dateKey, termId, blockers.holidays)) return true;
  return blockers.fullDayDatesByTerm.get(termId)?.has(dateKey) ?? false;
}

export async function shouldSkipClassSessionCreation(input: {
  dayTime: string | null | undefined;
  timeZone: string | null | undefined;
  termId: string | null | undefined;
}): Promise<boolean> {
  if (!input.termId) return false;
  const dateKey = resolveClassOccurrenceDateKey(input.dayTime, input.timeZone);
  if (!dateKey) return false;
  const blockers = await loadClassOccurrenceBlockers([input.termId]);
  return isClassOccurrenceBlocked(dateKey, input.termId, blockers);
}
