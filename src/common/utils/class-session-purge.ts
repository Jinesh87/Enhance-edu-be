import { IsNull } from "typeorm";
import { AppDataSource } from "../../config/data-source.js";
import { Assessment } from "../../entities/Assessment.js";
import { Class } from "../../entities/Class.js";
import { Session } from "../../entities/Session.js";
import { calendarDateFromDayTime } from "./holidays.js";
import {
  calendarDateInTimeZone,
  DEFAULT_CLASS_TIMEZONE,
} from "./timezone.js";
import {
  isClassOccurrenceBlocked,
  loadClassOccurrenceBlockers,
} from "./class-occurrence-guards.js";

type ClassWithTermId = Class & { termId?: string | null };

export function expandDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${String(startDate).slice(0, 10)}T12:00:00.000Z`);
  const end = new Date(`${String(endDate).slice(0, 10)}T12:00:00.000Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return dates;
  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Permanently remove class sessions on the given calendar dates.
 * For one-shot classes (dayTime = YYYY-MM-DD…), clears dayTime so nothing can
 * recreate the occurrence from the Class row (calendar open, self-heal, etc.).
 * Never creates sessions.
 */
export async function purgeClassSessionsOnDates(input: {
  dates: string[];
  termId?: string | null;
}): Promise<number> {
  const dates = [
    ...new Set(
      input.dates
        .map((d) => String(d).slice(0, 10))
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
    ),
  ];
  if (dates.length === 0) return 0;

  const minDate = dates.reduce((a, b) => (a < b ? a : b));
  const maxDate = dates.reduce((a, b) => (a > b ? a : b));
  const startBuffer = new Date(
    Date.parse(`${minDate}T00:00:00.000Z`) - 24 * 60 * 60 * 1000,
  );
  const endBuffer = new Date(
    Date.parse(`${maxDate}T23:59:59.999Z`) + 24 * 60 * 60 * 1000,
  );

  const qb = AppDataSource.getRepository(Session)
    .createQueryBuilder("session")
    .leftJoinAndSelect("session.class", "class")
    .where("session.assessmentId IS NULL")
    .andWhere("session.classId IS NOT NULL")
    .andWhere(
      "session.startAt >= :startBuffer AND session.startAt <= :endBuffer",
      { startBuffer, endBuffer },
    );

  if (input.termId) {
    qb.andWhere("class.termId = :termId", { termId: input.termId });
  }

  const sessions = await qb.getMany();
  const dateSet = new Set(dates);
  const toRemove = sessions.filter((s) => {
    const tz = s.class?.timeZone || DEFAULT_CLASS_TIMEZONE;
    return dateSet.has(calendarDateInTimeZone(s.startAt, tz));
  });

  if (toRemove.length > 0) {
    await AppDataSource.getRepository(Session).remove(toRemove);
  }

  const classQb = AppDataSource.getRepository(Class)
    .createQueryBuilder("class")
    .where("class.dayTime IS NOT NULL");
  if (input.termId) {
    classQb.andWhere("class.termId = :termId", { termId: input.termId });
  }

  const classes = (await classQb.getMany()) as ClassWithTermId[];
  const toClear: Class[] = [];
  for (const cls of classes) {
    const dayDate = calendarDateFromDayTime(cls.dayTime);
    if (dayDate && dateSet.has(dayDate)) {
      cls.dayTime = null;
      toClear.push(cls);
    }
  }
  if (toClear.length > 0) {
    await AppDataSource.getRepository(Class).save(toClear);
  }

  return toRemove.length;
}

/**
 * Delete assessments (and cascaded assessment sessions) on the given dates.
 * Holidays outrank assessments — schedule is cleared so the holiday can stand alone.
 */
export async function purgeAssessmentsOnDates(input: {
  dates: string[];
  termId?: string | null;
}): Promise<number> {
  const dates = [
    ...new Set(
      input.dates
        .map((d) => String(d).slice(0, 10))
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
    ),
  ];
  if (dates.length === 0) return 0;

  const minDate = dates.reduce((a, b) => (a < b ? a : b));
  const maxDate = dates.reduce((a, b) => (a > b ? a : b));
  const dateSet = new Set(dates);

  const qb = AppDataSource.getRepository(Assessment)
    .createQueryBuilder("assessment")
    .where("assessment.assessmentDate >= :minDate", { minDate })
    .andWhere("assessment.assessmentDate <= :maxDate", { maxDate })
    .andWhere("assessment.status NOT IN (:...excluded)", {
      excluded: ["ARCHIVED", "CANCELLED"],
    });

  if (input.termId) {
    qb.andWhere("assessment.termId = :termId", { termId: input.termId });
  }

  const rows = await qb.getMany();
  const toDelete = rows.filter((row) =>
    dateSet.has(String(row.assessmentDate).slice(0, 10)),
  );
  if (toDelete.length === 0) return 0;

  await AppDataSource.getRepository(Assessment).remove(toDelete);
  return toDelete.length;
}

/** Holiday authority: clear class sessions + assessments for the date range. */
export async function applyHolidayScheduleAuthority(input: {
  startDate: string;
  endDate: string;
  termId?: string | null;
}): Promise<{ sessionsRemoved: number; assessmentsRemoved: number }> {
  const dates = expandDateRange(input.startDate, input.endDate);
  const sessionsRemoved = await purgeClassSessionsOnDates({
    dates,
    termId: input.termId ?? null,
  });
  const assessmentsRemoved = await purgeAssessmentsOnDates({
    dates,
    termId: input.termId ?? null,
  });
  return { sessionsRemoved, assessmentsRemoved };
}

/**
 * Read-path defense: delete class sessions / one-shot dayTimes that sit on
 * active FULL_DAY or holiday dates. Never creates rows.
 */
export async function reconcileBlockedClassSessions(
  termIds: string[],
): Promise<number> {
  const uniqueTermIds = [...new Set(termIds.filter(Boolean))];
  if (uniqueTermIds.length === 0) return 0;

  const blockers = await loadClassOccurrenceBlockers(uniqueTermIds);
  const datesByTerm = new Map<string, Set<string>>();

  const addDate = (termId: string, dateKey: string) => {
    const set = datesByTerm.get(termId) ?? new Set<string>();
    set.add(dateKey);
    datesByTerm.set(termId, set);
  };

  const sessions = await AppDataSource.getRepository(Session)
    .createQueryBuilder("session")
    .innerJoinAndSelect("session.class", "class")
    .where("session.assessmentId IS NULL")
    .andWhere("class.termId IN (:...termIds)", { termIds: uniqueTermIds })
    .getMany();

  for (const session of sessions) {
    const termId = (session.class as ClassWithTermId | undefined)?.termId;
    if (!termId) continue;
    const tz = session.class?.timeZone || DEFAULT_CLASS_TIMEZONE;
    const dateKey = calendarDateInTimeZone(session.startAt, tz);
    if (isClassOccurrenceBlocked(dateKey, termId, blockers)) {
      addDate(termId, dateKey);
    }
  }

  const classes = (await AppDataSource.getRepository(Class)
    .createQueryBuilder("class")
    .where("class.dayTime IS NOT NULL")
    .andWhere("class.termId IN (:...termIds)", { termIds: uniqueTermIds })
    .getMany()) as ClassWithTermId[];

  for (const cls of classes) {
    const termId = cls.termId;
    const dayDate = calendarDateFromDayTime(cls.dayTime);
    if (!termId || !dayDate) continue;
    if (isClassOccurrenceBlocked(dayDate, termId, blockers)) {
      addDate(termId, dayDate);
    }
  }

  let removed = 0;
  for (const [termId, dates] of datesByTerm) {
    removed += await purgeClassSessionsOnDates({
      dates: [...dates],
      termId,
    });
  }
  return removed;
}

export async function clearOneShotClassOccurrence(input: {
  classId: string;
  date: string;
}): Promise<void> {
  const dateStr = String(input.date).slice(0, 10);
  const classRepo = AppDataSource.getRepository(Class);
  const sessionRepo = AppDataSource.getRepository(Session);
  const cls = await classRepo.findOne({ where: { id: input.classId } });
  if (!cls) return;

  if (calendarDateFromDayTime(cls.dayTime) === dateStr) {
    cls.dayTime = null;
    await classRepo.save(cls);
  }

  const sessions = await sessionRepo.find({
    where: { classId: input.classId, assessmentId: IsNull() },
    relations: { class: true },
  });
  const toRemove = sessions.filter((s) => {
    const tz = s.class?.timeZone || cls.timeZone || DEFAULT_CLASS_TIMEZONE;
    return calendarDateInTimeZone(s.startAt, tz) === dateStr;
  });
  if (toRemove.length > 0) {
    await sessionRepo.remove(toRemove);
  }
}
