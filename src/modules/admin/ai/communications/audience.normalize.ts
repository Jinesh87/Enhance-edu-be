import { UserRole, UserStatus } from "../../../../common/constants/roles.js";
import type {
  CommunicationAudience,
  CommunicationAudienceOption,
} from "../../../../entities/AdminAiCommunicationDraft.js";

/** Extensible audience groups — add handlers in AudienceResolverService. */
export const AUDIENCE_GROUPS = [
  "OVERDUE_HOMEWORK",
  "ABSENCES",
  "SESSION_TEACHERS",
  "ASSESSMENT_PARTICIPANTS",
  "ENQUIRY_CONTACTS",
  "CLASS_ROSTER",
  "ENROLLED",
] as const;

export type AudienceGroup = (typeof AUDIENCE_GROUPS)[number];

export const AUDIENCE_ROLES = [
  UserRole.STUDENT,
  UserRole.STAFF,
  UserRole.OFFICE_STAFF,
  UserRole.GUARDIAN,
  UserRole.SUPER_ADMIN,
] as const;

/** Legacy preset → filter-first shape (backward compatible). */
const LEGACY_TYPE_TO_FILTERS: Record<
  string,
  Pick<CommunicationAudience, "roles" | "groups" | "recipientOf">
> = {
  STUDENTS: { roles: [UserRole.STUDENT], recipientOf: "SELF" },
  TEACHERS: { roles: [UserRole.STAFF], recipientOf: "SELF" },
  OFFICE_STAFF: { roles: [UserRole.OFFICE_STAFF], recipientOf: "SELF" },
  GUARDIANS: { roles: [UserRole.GUARDIAN], recipientOf: "SELF" },
  ACTIVE_GUARDIANS: { roles: [UserRole.GUARDIAN], recipientOf: "SELF" },
  CLASS_ROSTER: {
    roles: [UserRole.STUDENT],
    groups: ["CLASS_ROSTER"],
    recipientOf: "SELF",
  },
  PARENTS_OF_ABSENCES: {
    roles: [UserRole.STUDENT],
    groups: ["ABSENCES"],
    recipientOf: "PARENTS",
  },
  STUDENTS_OVERDUE_HOMEWORK: {
    roles: [UserRole.STUDENT],
    groups: ["OVERDUE_HOMEWORK"],
    recipientOf: "SELF",
  },
  PARENTS_WITH_OVERDUE_HOMEWORK: {
    roles: [UserRole.STUDENT],
    groups: ["OVERDUE_HOMEWORK"],
    recipientOf: "PARENTS",
  },
  TEACHERS_OF_SESSIONS: {
    roles: [UserRole.STAFF],
    groups: ["SESSION_TEACHERS"],
    recipientOf: "SELF",
  },
  USERS_BY_IDS: { recipientOf: "SELF" },
};

const ROLE_ALIASES: Record<string, string> = {
  STUDENT: UserRole.STUDENT,
  STUDENTS: UserRole.STUDENT,
  TEACHER: UserRole.STAFF,
  TEACHERS: UserRole.STAFF,
  TUTOR: UserRole.STAFF,
  TUTORS: UserRole.STAFF,
  STAFF: UserRole.STAFF,
  OFFICE_STAFF: UserRole.OFFICE_STAFF,
  ADMIN: UserRole.OFFICE_STAFF,
  ADMINS: UserRole.OFFICE_STAFF,
  ADMIN_STAFF: UserRole.OFFICE_STAFF,
  GUARDIAN: UserRole.GUARDIAN,
  GUARDIANS: UserRole.GUARDIAN,
  PARENT: UserRole.GUARDIAN,
  PARENTS: UserRole.GUARDIAN,
  APPLICATION_OWNER: UserRole.SUPER_ADMIN,
  OWNER: UserRole.SUPER_ADMIN,
  SUPER_ADMIN: UserRole.SUPER_ADMIN,
};

const GROUP_ALIASES: Record<string, AudienceGroup> = {
  OVERDUE_HOMEWORK: "OVERDUE_HOMEWORK",
  HOMEWORK_OVERDUE: "OVERDUE_HOMEWORK",
  ABSENCES: "ABSENCES",
  ABSENT: "ABSENCES",
  SESSION_TEACHERS: "SESSION_TEACHERS",
  TOMORROW_TEACHERS: "SESSION_TEACHERS",
  ASSESSMENT_PARTICIPANTS: "ASSESSMENT_PARTICIPANTS",
  ASSESSMENT: "ASSESSMENT_PARTICIPANTS",
  ENQUIRY_CONTACTS: "ENQUIRY_CONTACTS",
  ENQUIRIES: "ENQUIRY_CONTACTS",
  CLASS_ROSTER: "CLASS_ROSTER",
  ENROLLED: "ENROLLED",
  ENROLMENT: "ENROLLED",
  ENROLLMENT: "ENROLLED",
};

export function normalizeRole(raw: string): string | null {
  const key = raw.trim().toUpperCase().replace(/\s+/g, "_");
  if (!key) return null;
  if (ROLE_ALIASES[key]) return ROLE_ALIASES[key]!;
  if ((AUDIENCE_ROLES as readonly string[]).includes(key)) return key;
  return null;
}

export function normalizeGroup(raw: string): AudienceGroup | null {
  const key = raw.trim().toUpperCase().replace(/\s+/g, "_");
  if (!key) return null;
  return GROUP_ALIASES[key] ?? null;
}

export function expandLegacyType(
  typeRaw: string | null | undefined,
): Pick<CommunicationAudience, "roles" | "groups" | "recipientOf"> | null {
  if (!typeRaw?.trim()) return null;
  const key = typeRaw.trim().toUpperCase().replace(/\s+/g, "_");
  return LEGACY_TYPE_TO_FILTERS[key] ?? null;
}

/** @deprecated Prefer filter-first roles/groups; kept for old callers. */
export function normalizeAudienceType(raw: string): string | null {
  const key = raw.trim().toUpperCase().replace(/\s+/g, "_");
  if (!key) return null;
  if (LEGACY_TYPE_TO_FILTERS[key]) return key;
  return null;
}

export function isCommunicationAudienceType(value: string): boolean {
  return Boolean(normalizeAudienceType(value));
}

export function describeAudience(audience: CommunicationAudience): string {
  if (audience.label?.trim()) return audience.label.trim();

  const recipientOf = (audience.recipientOf ?? "SELF").toUpperCase();
  const roles = (audience.roles ?? []).map((r) => r.toUpperCase());
  const groups = (audience.groups ?? []).map((g) => g.toUpperCase());
  const name = audience.nameQuery?.trim() ?? "";
  const year = audience.yearLevel?.trim() ?? "";
  const subject = audience.subject?.trim() ?? "";
  const className = audience.className?.trim() ?? "";
  const term = audience.term?.trim() ?? "";
  const date = audience.date?.trim() ?? "";

  // Named student → their linked parent/guardian (individual)
  if (
    recipientOf === "PARENTS" &&
    name &&
    !year &&
    !subject &&
    !className &&
    !groups.length
  ) {
    return `Parent of ${name}`;
  }

  // Bulk parents with academic context
  if (recipientOf === "PARENTS") {
    if (groups.includes("ABSENCES")) {
      return date
        ? `Parents of students absent on ${date}`
        : "Parents of absent students";
    }
    if (groups.includes("OVERDUE_HOMEWORK")) {
      return "Parents of students with overdue homework";
    }
    const academic = [year, subject || className].filter(Boolean).join(" ");
    if (academic) return `${academic} Parents`;
    if (roles.includes(UserRole.STUDENT) || !roles.length) {
      return "Student parents";
    }
  }

  const parts: string[] = [];
  if (groups.includes("ABSENCES")) parts.push("students absent");
  else if (groups.includes("OVERDUE_HOMEWORK")) {
    parts.push("students with overdue homework");
  } else if (groups.includes("SESSION_TEACHERS")) {
    parts.push("teachers for scheduled sessions");
  } else if (groups.includes("ASSESSMENT_PARTICIPANTS")) {
    parts.push("assessment participants");
  } else if (groups.includes("ENQUIRY_CONTACTS")) {
    parts.push("enquiry contacts");
  } else if (groups.includes("CLASS_ROSTER")) {
    parts.push("class roster students");
  } else if (roles.includes(UserRole.STAFF)) parts.push("teachers");
  else if (roles.includes(UserRole.OFFICE_STAFF)) parts.push("admin staff");
  else if (roles.includes(UserRole.GUARDIAN)) parts.push("guardians");
  else if (roles.includes(UserRole.STUDENT)) {
    parts.push(name ? name : "students");
  } else if (audience.userIds?.length) parts.push("selected users");
  else if (name) parts.push(name);
  else parts.push("recipients");

  if (year && !parts.includes(year)) parts.push(year);
  if (subject && !parts.includes(subject)) parts.push(subject);
  if (className && !parts.includes(className)) parts.push(className);
  if (term) parts.push(term);
  if (date) parts.push(`on ${date}`);
  if (audience.assessmentQuery?.trim()) {
    parts.push(`· ${audience.assessmentQuery.trim()}`);
  }

  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export function suggestAmbiguityOptions(
  intent: string | null | undefined,
): CommunicationAudienceOption[] | null {
  const text = (intent ?? "").toLowerCase();
  if (!text) return null;
  const mentionsMessage = /\b(message|email|notify|send|remind)\b/.test(text);
  const mentionsYear = /\byear\s*\d+\b|\byear\s*level\b/.test(text);
  const mentionsStudents = /\bstudents?\b/.test(text);
  const mentionsParents = /\b(parents?|guardians?)\b/.test(text);
  if (
    mentionsMessage &&
    mentionsYear &&
    !mentionsStudents &&
    !mentionsParents &&
    !/\b(teacher|staff|tutor|admin)\b/.test(text)
  ) {
    return [
      {
        label: "Year-level students",
        roles: [UserRole.STUDENT],
        recipientOf: "SELF",
      },
      {
        label: "Parents of year-level students",
        roles: [UserRole.STUDENT],
        recipientOf: "PARENTS",
      },
    ];
  }
  return null;
}

export function audienceHasTarget(audience: CommunicationAudience): boolean {
  return Boolean(
    (audience.roles?.length ?? 0) > 0 ||
      (audience.groups?.length ?? 0) > 0 ||
      (audience.userIds?.length ?? 0) > 0 ||
      audience.nameQuery?.trim() ||
      audience.className?.trim() ||
      audience.assessmentQuery?.trim() ||
      audience.type?.trim(),
  );
}

export function defaultAudienceStatus(
  status: string | null | undefined,
): string {
  const raw = status?.trim().toUpperCase();
  if (raw && Object.values(UserStatus).includes(raw as UserStatus)) return raw;
  return UserStatus.ACTIVE;
}
