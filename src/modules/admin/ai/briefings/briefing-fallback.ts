import type { BriefingSnapshot } from "./briefing-snapshot.service.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

function formatRange(payload: Record<string, unknown>): string {
  const start = typeof payload.startDate === "string" ? payload.startDate : null;
  const end = typeof payload.endDate === "string" ? payload.endDate : null;
  if (start && end) return ` from ${start} to ${end}`;
  return "";
}

function formatByStatus(byStatus: Record<string, unknown>): string {
  const preferred = ["ABSENT", "PENDING", "LATE", "PRESENT", "EXCUSED"];
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const key of [...preferred, ...Object.keys(byStatus)]) {
    if (seen.has(key)) continue;
    seen.add(key);
    const count = asNumber(byStatus[key]);
    if (count == null || count <= 0) continue;
    parts.push(`${count} ${key.toLowerCase().replace(/_/g, " ")}`);
  }
  return parts.join(", ");
}

function unavailable(sectionLabel: string, payload: Record<string, unknown>): string | null {
  if (payload.error !== "unavailable") return null;
  return `${sectionLabel} data is unavailable right now.`;
}

export function formatAttendanceBriefing(payload: Record<string, unknown>): string {
  const blocked = unavailable("Attendance", payload);
  if (blocked) return blocked;
  const total = asNumber(payload.totalRecords) ?? 0;
  const rate = asNumber(payload.presentOrLateRatePercent);
  const range = formatRange(payload);
  const breakdown = asRecord(payload.byStatus)
    ? formatByStatus(asRecord(payload.byStatus)!)
    : "";
  if (total === 0) return `No attendance records${range}.`;
  const rateText =
    rate == null ? "" : ` Present or late rate is ${rate}%.`;
  return `${total} attendance ${plural(total, "record")}${range}${
    breakdown ? ` (${breakdown})` : ""
  }.${rateText}`;
}

export function formatTasksBriefing(payload: Record<string, unknown>): string {
  const blocked = unavailable("Task", payload);
  if (blocked) return blocked;
  const open = asNumber(payload.openTaskCount) ?? 0;
  const overdue = asNumber(payload.overdueOpenTaskCount) ?? 0;
  if (open === 0) return "No open tasks.";
  if (overdue === 0) {
    return `${open} open ${plural(open, "task")}; none overdue.`;
  }
  if (overdue === open) {
    return `${open} open ${plural(open, "task")}, all overdue.`;
  }
  return `${open} open ${plural(open, "task")}, ${overdue} overdue.`;
}

export function formatEnquiriesBriefing(payload: Record<string, unknown>): string {
  const blocked = unavailable("Enquiry", payload);
  if (blocked) return blocked;
  const open = asNumber(payload.openCount) ?? 0;
  const stages = Array.isArray(payload.stages) ? payload.stages : [];
  const named = stages
    .map((row) => {
      const rec = asRecord(row);
      if (!rec) return null;
      const count = asNumber(rec.count) ?? 0;
      if (count <= 0) return null;
      const stage = typeof rec.stage === "string" ? rec.stage : null;
      if (!stage) return null;
      return `${count} in ${stage}`;
    })
    .filter((value): value is string => Boolean(value));
  if (open === 0) return "No open enquiries.";
  const noun = plural(open, "enquiry", "enquiries");
  if (named.length > 0) return `${open} open ${noun} (${named.join(", ")}).`;
  return `${open} open ${noun}.`;
}

export function formatHomeworkBriefing(payload: Record<string, unknown>): string {
  const blocked = unavailable("Homework", payload);
  if (blocked) return blocked;
  const count = asNumber(payload.homeworkCount) ?? 0;
  const submitted = asNumber(payload.submittedCount) ?? 0;
  const pending = asNumber(payload.pendingCount) ?? 0;
  const assigned = asNumber(payload.assignedStudents) ?? 0;
  const range = formatRange(payload);
  if (count === 0) return `No homework due${range}.`;
  return `${count} homework ${plural(count, "item")}${range}: ${submitted} submitted, ${pending} pending (${assigned} ${plural(assigned, "student")} assigned).`;
}

export function formatOperationsBriefing(payload: Record<string, unknown>): string {
  const blocked = unavailable("Operations", payload);
  if (blocked) return blocked;
  const people = asRecord(payload.people) ?? {};
  const classes = asRecord(payload.classes) ?? {};
  const enrolments = asRecord(payload.enrolments) ?? {};
  const enquiries = asRecord(payload.enquiries) ?? {};
  const tasks = asRecord(payload.tasks) ?? {};
  const absences = asRecord(payload.absencesToday) ?? {};

  const students =
    asNumber(people.activeStudents) ?? asNumber(payload.activeStudents);
  const staff =
    asNumber(people.activeStaffTeachers) ??
    asNumber(payload.activeStaffTeachers);
  const classCount =
    asNumber(classes.classCount) ?? asNumber(payload.classCount);
  const activeEnrol =
    asNumber(enrolments.activeEnrolments) ??
    asNumber(payload.activeEnrolments);
  const pendingEnrol =
    asNumber(enrolments.pendingEnrolments) ??
    asNumber(payload.pendingEnrolments);
  const openEnquiries =
    asNumber(enquiries.openEnquiries) ?? asNumber(payload.openEnquiries);
  const openTasks = asNumber(tasks.openTasks) ?? asNumber(payload.openTasks);
  const overdue =
    asNumber(tasks.overdueOpenTasks) ?? asNumber(payload.overdueOpenTasks);
  const absencesToday = asNumber(absences.count);

  const parts: string[] = [];
  if (students != null) {
    parts.push(`${students} active ${plural(students, "student")}`);
  }
  if (staff != null) parts.push(`${staff} staff`);
  if (classCount != null) {
    parts.push(`${classCount} ${plural(classCount, "class", "classes")}`);
  }
  if (activeEnrol != null) {
    parts.push(`${activeEnrol} active ${plural(activeEnrol, "enrolment")}`);
  }
  if (pendingEnrol != null && pendingEnrol > 0) {
    parts.push(
      `${pendingEnrol} pending ${plural(pendingEnrol, "enrolment")}`,
    );
  }
  if (openEnquiries != null) {
    parts.push(
      `${openEnquiries} open ${plural(openEnquiries, "enquiry", "enquiries")}`,
    );
  }
  if (openTasks != null) {
    const overdueBit =
      overdue != null && overdue > 0 ? ` (${overdue} overdue)` : "";
    parts.push(`${openTasks} open ${plural(openTasks, "task")}${overdueBit}`);
  }
  if (absencesToday != null && absencesToday > 0) {
    parts.push(`${absencesToday} ${plural(absencesToday, "absence")} today`);
  }
  if (parts.length === 0) return "No operations metrics available.";
  return `${parts.join("; ")}.`;
}

function formatGenericSection(
  sectionLabel: string,
  payload: Record<string, unknown>,
): string {
  const blocked = unavailable(sectionLabel, payload);
  if (blocked) return blocked;
  const skip = new Set([
    "responseHint",
    "note",
    "entity",
    "unavailable",
    "truncated",
  ]);
  const bits: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (skip.has(key)) continue;
    const count = asNumber(value);
    if (count == null) continue;
    const label = key
      .replace(/([A-Z])/g, " $1")
      .replace(/_/g, " ")
      .toLowerCase()
      .trim();
    bits.push(`${label} ${count}`);
    if (bits.length >= 4) break;
  }
  return bits.length > 0
    ? `${bits.join("; ")}.`
    : `${sectionLabel} has no readable metrics.`;
}

const SECTION_FORMATTERS: Record<
  string,
  (payload: Record<string, unknown>) => string
> = {
  attendance: formatAttendanceBriefing,
  tasks: formatTasksBriefing,
  enquiries: formatEnquiriesBriefing,
  homework: formatHomeworkBriefing,
  operations: formatOperationsBriefing,
};

function sectionLabel(section: string): string {
  return section.charAt(0).toUpperCase() + section.slice(1);
}

export function fallbackFromSnapshot(
  snapshot: BriefingSnapshot,
): { title: string; summary: string; usedAi: false } {
  const lines: string[] = [];
  for (const section of snapshot.sections) {
    const payload = asRecord(snapshot.data[section]);
    if (!payload) continue;
    const formatter =
      SECTION_FORMATTERS[section] ??
      ((row: Record<string, unknown>) =>
        formatGenericSection(sectionLabel(section), row));
    lines.push(`• ${sectionLabel(section)}: ${formatter(payload)}`);
  }
  return {
    title: "Morning briefing",
    summary:
      lines.length > 0
        ? lines.join("\n")
        : "No briefing metrics were available for the selected sections.",
    usedAi: false,
  };
}
