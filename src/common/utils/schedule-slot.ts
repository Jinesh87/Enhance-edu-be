import { calendarDateFromDayTime } from "./holidays.js";

export function startTimeFromDayTime(
  dayTime: string | null | undefined,
): string | null {
  if (!dayTime) return null;
  const isoPart = dayTime.split(" ")[0]?.trim() ?? "";
  const timeSegment = isoPart.includes("T") ? isoPart.split("T")[1] : null;
  if (!timeSegment) return null;
  const [hh, mm] = timeSegment.split(":");
  if (!hh || !mm) return null;
  return `${hh.padStart(2, "0")}:${mm.padStart(2, "0")}`;
}

export function normalizeScheduleSubject(
  subject: string | null | undefined,
): string {
  return (subject ?? "").trim().toLowerCase();
}

export type ScheduleSlotInput = {
  dayTime?: string | null;
  subject?: string | null;
  teacherId?: string | null;
  teacher?: { id: string } | null;
};

/** Unique key for one timetable occurrence: date + start time + subject + teacher. */
export function buildScheduleSlotKey(
  input: ScheduleSlotInput,
): string | null {
  const date = calendarDateFromDayTime(input.dayTime);
  const time = startTimeFromDayTime(input.dayTime);
  if (!date || !time) return null;
  const subject = normalizeScheduleSubject(input.subject);
  const teacherId = input.teacherId ?? input.teacher?.id ?? "";
  return `${date}|${time}|${subject}|${teacherId}`;
}
