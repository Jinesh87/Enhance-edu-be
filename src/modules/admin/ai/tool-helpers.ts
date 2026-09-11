import type { AdminAiSource } from "../../../entities/AdminAiMessage.js";
import {
  calendarDateInTimeZone,
  dayRangeInTimeZone,
  DEFAULT_CLASS_TIMEZONE,
  formatInTimeZone,
  parseWallClockFromDayTime,
  resolveIanaTimeZone,
  zonedWallTimeToUtc,
} from "../../../common/utils/timezone.js";

export const MAX_RANGE_DAYS = 62;
export const MAX_ROWS = 40;
export const LIST_MAX_ROWS = 60;

/** Structured deep-link metadata. Never sent to the LLM as free-form URLs. */
export type AdminAiOpenPageAction = {
  type: "OPEN_PAGE";
  resource: string;
  id?: string | null;
  filters?: Record<string, string>;
  label: string;
};

/** Download action — reportId only; FE fetches PDF via API. */
export type AdminAiDownloadReportAction = {
  type: "DOWNLOAD_REPORT";
  reportId: string;
  label: string;
};

/** Confirm PDF generation from a preview draft. */
export type AdminAiGenerateReportAction = {
  type: "GENERATE_REPORT";
  draftId: string;
  label: string;
};

/** Focus chat composer so the user can refine the preview before PDF. */
export type AdminAiAdjustReportAction = {
  type: "ADJUST_REPORT";
  draftId: string;
  label: string;
};

/** Confirm sending a communication draft (email). */
export type AdminAiConfirmSendAction = {
  type: "CONFIRM_SEND";
  draftId: string;
  label: string;
};

export type AdminAiUiAction =
  | AdminAiOpenPageAction
  | AdminAiDownloadReportAction
  | AdminAiGenerateReportAction
  | AdminAiAdjustReportAction
  | AdminAiConfirmSendAction;

export type ToolResult = {
  data: unknown;
  sources: AdminAiSource[];
  /** Allowlisted UI actions (not shown to the model as URLs). */
  actions?: AdminAiUiAction[];
  documentIds?: string[];
};

export function openPageAction(
  resource: string,
  label: string,
  options?: {
    id?: string | null;
    filters?: Record<string, string | null | undefined>;
  },
): AdminAiOpenPageAction {
  const filters: Record<string, string> = {};
  if (options?.filters) {
    for (const [key, value] of Object.entries(options.filters)) {
      if (typeof value === "string" && value.trim()) {
        filters[key] = value.trim();
      }
    }
  }
  return {
    type: "OPEN_PAGE",
    resource,
    id: options?.id?.trim() ? options.id.trim() : null,
    filters,
    label,
  };
}

export function downloadReportAction(
  reportId: string,
  label = "Download PDF",
): AdminAiDownloadReportAction {
  return {
    type: "DOWNLOAD_REPORT",
    reportId: reportId.trim(),
    label,
  };
}

export function generateReportAction(
  draftId: string,
  label = "Generate PDF",
): AdminAiGenerateReportAction {
  return {
    type: "GENERATE_REPORT",
    draftId: draftId.trim(),
    label,
  };
}

export function adjustReportAction(
  draftId: string,
  label = "Adjust preview",
): AdminAiAdjustReportAction {
  return {
    type: "ADJUST_REPORT",
    draftId: draftId.trim(),
    label,
  };
}

export function confirmSendCommunicationAction(
  draftId: string,
  label = "Confirm Send",
): AdminAiConfirmSendAction {
  return {
    type: "CONFIRM_SEND",
    draftId: draftId.trim(),
    label,
  };
}

export function actionSource(action: AdminAiUiAction): AdminAiSource {
  if (action.type === "DOWNLOAD_REPORT") {
    return {
      kind: "action",
      label: action.label,
      downloadReport: action,
    };
  }
  if (action.type === "GENERATE_REPORT") {
    return {
      kind: "action",
      label: action.label,
      generateReport: action,
    };
  }
  if (action.type === "ADJUST_REPORT") {
    return {
      kind: "action",
      label: action.label,
      adjustReport: action,
    };
  }
  if (action.type === "CONFIRM_SEND") {
    return {
      kind: "action",
      label: action.label,
      confirmSend: action,
    };
  }
  return {
    kind: "action",
    label: action.label,
    openPage: action,
  };
}


export function parseDateOnly(value: string | undefined, fallback: Date): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

export function sanitizeDateArg(value?: string): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const diffDays = Math.abs(Date.now() - parsed.getTime()) / 86_400_000;
  // Ignore nonsense model dates far from today (e.g. 2023-10-10).
  if (diffDays > 400) return undefined;
  return value;
}

export function clampRange(startDate?: string, endDate?: string) {
  const safeEnd = sanitizeDateArg(endDate);
  const safeStart = sanitizeDateArg(startDate);
  let end = parseDateOnly(safeEnd, new Date());
  const startDefault = new Date(end);
  startDefault.setUTCDate(startDefault.getUTCDate() - 7);
  let start = parseDateOnly(safeStart, startDefault);
  if (start > end) {
    const tmp = start;
    start = end;
    end = tmp;
  }
  const maxStart = new Date(end);
  maxStart.setUTCDate(maxStart.getUTCDate() - MAX_RANGE_DAYS);
  if (start < maxStart) start = maxStart;
  const endExclusive = new Date(end);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return { start, end, endExclusive };
}

export function dayBoundsInClassTz(date?: string, timeZone?: string | null) {
  const tz = resolveIanaTimeZone(timeZone ?? DEFAULT_CLASS_TIMEZONE);
  let ref = new Date();
  const safeDate = sanitizeDateArg(date);
  if (safeDate) {
    const [year, month, day] = safeDate.split("-").map(Number);
    ref = zonedWallTimeToUtc(
      { year, month, day, hour: 12, minute: 0, second: 0 },
      tz,
    );
  }
  const { start, end } = dayRangeInTimeZone(ref, tz);
  return {
    start,
    end,
    label: calendarDateInTimeZone(ref, tz),
    timeZone: tz,
  };
}

export function formatLocalTime12h(value: Date, timeZone?: string | null): string {
  return formatInTimeZone(value, timeZone, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).toLowerCase();
}

export function formatWallClock12h(hour: number, minute: number): string {
  const ampm = hour >= 12 ? "pm" : "am";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${ampm}`;
}

export function weekdayFromDayTime(dayTime: string | null): string | null {
  const parsed = parseWallClockFromDayTime(dayTime);
  if (!parsed) return null;
  const dayName = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ][
    new Date(
      Date.UTC(parsed.start.year, parsed.start.month - 1, parsed.start.day, 12),
    ).getUTCDay()
  ];
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

export function durationFromDayTime(dayTime: string | null): string {
  const parsed = parseWallClockFromDayTime(dayTime);
  if (!parsed?.end) return "1 hr";
  const startMinutes = parsed.start.hour * 60 + parsed.start.minute;
  let endMinutes = parsed.end.hour * 60 + parsed.end.minute;
  if (endMinutes <= startMinutes) endMinutes += 24 * 60;
  const mins = endMinutes - startMinutes;
  if (mins >= 60 && mins % 60 === 0) return `${mins / 60} hr`;
  return `${mins} min`;
}

export function formatLocalSessionTime(
  startAt: Date,
  endAt: Date,
  timeZone?: string | null,
) {
  const tz = resolveIanaTimeZone(timeZone);
  const durationMinutes = Math.max(
    0,
    Math.round((endAt.getTime() - startAt.getTime()) / 60_000),
  );
  const durationLabel =
    durationMinutes >= 60 && durationMinutes % 60 === 0
      ? `${durationMinutes / 60} hr`
      : `${durationMinutes} min`;
  return {
    time: `${formatLocalTime12h(startAt, tz)} – ${formatLocalTime12h(endAt, tz)}`,
    startTime: formatLocalTime12h(startAt, tz),
    endTime: formatLocalTime12h(endAt, tz),
    duration: durationLabel,
    durationMinutes,
    timeZone: tz,
  };
}

export function formatHolidayDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function datesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string,
): boolean {
  return startA <= endB && endA >= startB;
}
