import {
  DEFAULT_CLASS_TIMEZONE,
  resolveIanaTimeZone,
  zonedWallTimeToUtc,
} from "../../../common/utils/timezone.js";
import { AppError } from "../../../common/errors/AppError.js";
import type { AssessmentScheduleType } from "../../../entities/index.js";

const CHECK_IN_EARLY_MINUTES = 15;
const SUBMISSION_GRACE_MINUTES = 25;

function normalizeDateKey(value: string | Date): string | null {
  if (typeof value === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    return match?.[1] ?? null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return null;
}

export function resolveAssessmentTimeZone(timeZone?: string | null): string {
  return resolveIanaTimeZone(timeZone ?? DEFAULT_CLASS_TIMEZONE);
}

export function assessmentScheduleWindow(
  assessmentDate: string | Date,
  startTime: string,
  durationMinutes: number,
  scheduleType: AssessmentScheduleType = "SESSION",
  timeZone?: string | null,
): { startAt: Date; endAt: Date } | null {
  const dateKey = normalizeDateKey(assessmentDate);
  if (!dateKey) return null;
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = (scheduleType === "FULL_DAY" ? "00:00" : startTime)
    .split(":")
    .map(Number);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return null;
  }
  const startAt = zonedWallTimeToUtc(
    { year, month, day, hour, minute, second: 0 },
    resolveAssessmentTimeZone(timeZone),
  );
  if (Number.isNaN(startAt.getTime())) return null;
  const duration =
    scheduleType === "FULL_DAY" ? 1440 : Math.max(durationMinutes || 60, 15);
  return {
    startAt,
    endAt: new Date(startAt.getTime() + duration * 60_000),
  };
}

type AssessmentTiming = {
  assessmentDate: string;
  startTime: string;
  durationMinutes: number;
  scheduleType?: AssessmentScheduleType;
  timeZone?: string | null;
};

export function assertStudentAssessmentWindowOpen(
  assessment: AssessmentTiming,
  purpose: "check-in" | "submission" = "submission",
): { startAt: Date; endAt: Date } {
  const window = assessmentScheduleWindow(
    assessment.assessmentDate,
    assessment.startTime,
    assessment.durationMinutes,
    assessment.scheduleType,
    assessment.timeZone,
  );
  if (!window) {
    throw new AppError(
      400,
      "Assessment schedule is invalid",
      "ASSESSMENT_SCHEDULE_INVALID",
    );
  }

  const now = Date.now();
  const earlyMinutes =
    purpose === "check-in" ? CHECK_IN_EARLY_MINUTES : 0;
  const lateMinutes =
    purpose === "check-in"
      ? 0
      : assessment.scheduleType === "FULL_DAY"
        ? 0
        : SUBMISSION_GRACE_MINUTES;
  const openAt =
    window.startAt.getTime() - earlyMinutes * 60_000;
  const closeAt = window.endAt.getTime() + lateMinutes * 60_000;

  if (now < openAt) {
    throw new AppError(
      400,
      "This assessment is not open yet",
      "ASSESSMENT_NOT_OPEN",
    );
  }
  if (now > closeAt) {
    throw new AppError(
      400,
      "This assessment window has closed",
      "ASSESSMENT_CLOSED",
    );
  }

  return window;
}
