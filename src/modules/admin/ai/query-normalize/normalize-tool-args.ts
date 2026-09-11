import { UserRole, UserStatus } from "../../../../common/constants/roles.js";
import { fuzzyMatchCanonical } from "./fuzzy.js";
import {
  NAME_ARG_KEYS,
  REPORT_TYPE_ALIAS_MAP,
  ROLE_ALIAS_MAP,
  STATUS_ALIAS_MAP,
  TERM_ALIAS_MAP,
  YEAR_LEVEL_ALIAS_MAP,
  sectionForTool,
} from "./registry.js";
import { normalizeQueryText, stripQueryNoise } from "./text.js";

export type NormalizeToolArgsContext = {
  /** Latest user message — used to recover intent when tool args are noisy. */
  userMessage?: string | null;
};

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function resolveRole(value: string | null): UserRole | null {
  if (!value) return null;
  const matched = fuzzyMatchCanonical(value, ROLE_ALIAS_MAP);
  if (matched && Object.values(UserRole).includes(matched as UserRole)) {
    return matched as UserRole;
  }
  return null;
}

function resolveStatus(value: string | null): string | null {
  if (!value) return null;
  return fuzzyMatchCanonical(value, STATUS_ALIAS_MAP);
}

function resolveYearLevel(value: string | null): string | null {
  if (!value) return null;
  return fuzzyMatchCanonical(value, YEAR_LEVEL_ALIAS_MAP) ?? value.trim();
}

function resolveTerm(value: string | null): string | null {
  if (!value) return null;
  return fuzzyMatchCanonical(value, TERM_ALIAS_MAP) ?? value.trim();
}

function resolveReportType(value: string | null): string | null {
  if (!value) return null;
  return fuzzyMatchCanonical(value, REPORT_TYPE_ALIAS_MAP) ?? value.trim().toUpperCase();
}

function cleanNameField(
  value: string | null,
  extraNoise: string[],
): string | null {
  if (!value) return null;
  const stripped = stripQueryNoise(value, extraNoise);
  if (!stripped) return null;
  // If the remaining text is itself a known role/section phrase, drop it.
  if (resolveRole(stripped)) return null;
  return stripped;
}

function normalizePeopleArgs(
  args: Record<string, unknown>,
  sectionNoise: string[],
): Record<string, unknown> {
  const next = { ...args };
  let role =
    resolveRole(asTrimmedString(next.role)) ??
    resolveRole(asTrimmedString(next.name));

  let name = cleanNameField(asTrimmedString(next.name), sectionNoise);

  if (name && resolveRole(name)) {
    if (!role) role = resolveRole(name);
    name = null;
  }

  if (name && role === UserRole.SUPER_ADMIN) {
    const cleaned = name
      .replace(/\b(application|app|super|admin|owner|owners)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    name = cleaned || null;
  }

  const status = resolveStatus(asTrimmedString(next.status));

  if (role) next.role = role;
  else delete next.role;

  if (name) next.name = name;
  else delete next.name;

  if (status) {
    // People directory uses UserStatus; keep only valid user statuses here.
    if (Object.values(UserStatus).includes(status as UserStatus)) {
      next.status = status;
    } else {
      delete next.status;
    }
  } else {
    delete next.status;
  }

  return next;
}

function normalizeFiltersObject(
  filters: Record<string, unknown>,
  sectionNoise: string[],
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...filters };

  if ("studentName" in next) {
    const cleaned = cleanNameField(
      asTrimmedString(next.studentName),
      sectionNoise,
    );
    if (cleaned) next.studentName = cleaned;
    else delete next.studentName;
  }
  if ("yearLevel" in next) {
    const year = resolveYearLevel(asTrimmedString(next.yearLevel));
    if (year) next.yearLevel = year;
    else delete next.yearLevel;
  }
  if ("term" in next) {
    const term = resolveTerm(asTrimmedString(next.term));
    if (term) next.term = term;
    else delete next.term;
  }
  if ("subject" in next) {
    const subject = cleanNameField(asTrimmedString(next.subject), [
      ...sectionNoise,
      "subject",
      "subjects",
    ]);
    if (subject) next.subject = subject;
    else delete next.subject;
  }
  if ("status" in next) {
    const status = resolveStatus(asTrimmedString(next.status));
    if (status) next.status = status;
    else delete next.status;
  }
  if ("academicYear" in next) {
    const ay = asTrimmedString(next.academicYear);
    if (ay) next.academicYear = ay.replace(/[^\d]/g, "") || ay;
    else delete next.academicYear;
  }

  return next;
}

/**
 * Normalize tool arguments for any Admin AI tool using the shared registry.
 * Extensible: add section aliases/fields in registry.ts without changing this core.
 */
export function normalizeToolArgs(
  toolName: string,
  args: Record<string, unknown>,
  context: NormalizeToolArgsContext = {},
): Record<string, unknown> {
  const section = sectionForTool(toolName);
  const sectionNoise = section?.noise ?? [];
  let next: Record<string, unknown> = { ...args };

  // Recover sparse people queries from the user message when role/name missing.
  if (
    toolName === "searchPeople" &&
    !asTrimmedString(next.role) &&
    context.userMessage
  ) {
    const fromMessage = resolveRole(context.userMessage);
    if (fromMessage) next.role = fromMessage;
  }

  if (toolName === "searchPeople") {
    return normalizePeopleArgs(next, sectionNoise);
  }

  for (const key of NAME_ARG_KEYS) {
    if (!(key in next)) continue;
    const cleaned = cleanNameField(asTrimmedString(next[key]), sectionNoise);
    if (cleaned) next[key] = cleaned;
    else delete next[key];
  }

  if ("role" in next) {
    const role = resolveRole(asTrimmedString(next.role));
    if (role) next.role = role;
    else delete next.role;
  }

  if ("status" in next) {
    const status = resolveStatus(asTrimmedString(next.status));
    if (status) next.status = status;
    else delete next.status;
  }

  if ("yearLevel" in next) {
    const year = resolveYearLevel(asTrimmedString(next.yearLevel));
    if (year) next.yearLevel = year;
    else delete next.yearLevel;
  }

  if ("term" in next) {
    const term = resolveTerm(asTrimmedString(next.term));
    if (term) next.term = term;
    else delete next.term;
  }

  if ("subject" in next || "subjectHint" in next) {
    const key = "subject" in next ? "subject" : "subjectHint";
    const subject = cleanNameField(asTrimmedString(next[key]), [
      ...sectionNoise,
      "subject",
      "subjects",
    ]);
    if (subject) next[key] = subject;
    else delete next[key];
  }

  if ("academicYear" in next) {
    const ay = asTrimmedString(next.academicYear);
    if (ay) next.academicYear = ay.replace(/[^\d]/g, "") || ay;
    else delete next.academicYear;
  }

  if ("reportType" in next) {
    const reportType = resolveReportType(asTrimmedString(next.reportType));
    if (reportType) next.reportType = reportType;
    else delete next.reportType;
  }

  if (
    next.filters &&
    typeof next.filters === "object" &&
    !Array.isArray(next.filters)
  ) {
    next.filters = normalizeFiltersObject(
      next.filters as Record<string, unknown>,
      sectionNoise,
    );
  }

  // If report tools got a noisy reportType from the user message only.
  if (
    (toolName === "previewReport" || toolName === "generateReport") &&
    !asTrimmedString(next.reportType) &&
    context.userMessage
  ) {
    const fromMessage = resolveReportType(
      normalizeQueryText(context.userMessage),
    );
    if (fromMessage) next.reportType = fromMessage;
  }

  return next;
}

export function peopleRoleLabel(role: UserRole): string {
  switch (role) {
    case UserRole.SUPER_ADMIN:
      return "Application Owner";
    case UserRole.OFFICE_STAFF:
      return "Staff";
    case UserRole.STAFF:
      return "Teacher";
    case UserRole.STUDENT:
      return "Student";
    case UserRole.GUARDIAN:
      return "Guardian";
    default:
      return role;
  }
}
