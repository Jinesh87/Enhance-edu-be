import type { AdminModuleId } from "../../../common/constants/modules.js";
import { ADMIN_MODULES } from "../../../common/constants/modules.js";
import { UserRole } from "../../../common/constants/roles.js";
import { AppError } from "../../../common/errors/AppError.js";
import {
  canUseAdminAiModule,
  type AdminAiActor,
} from "./authorization.js";

const ENROLMENT_INTENT_RE =
  /\b(enrolments?|enrollments?|enrolled)\b/i;
const ENQUIRY_INTENT_RE =
  /\b(enquir(?:y|ies)|inquir(?:y|ies)|leads?)\b/i;
const SYLLABUS_INTENT_RE =
  /\b(syllabus|syllabi|curriculum)\b/i;

/**
 * Tools that must not answer enrolment-only questions.
 * Includes ops snapshot — staff without Classes were getting a generic
 * permission error and the model reported “no enrolment access”.
 */
const ENROLMENT_SUBSTITUTE_TOOLS = new Set([
  "searchEnquiries",
  "getEnquiryPipelineSummary",
  "getOpsSnapshot",
]);

/** Tools that must not stand in for Syllabus catalogue/document questions. */
const SYLLABUS_SUBSTITUTE_TOOLS = new Set([
  "listSubjects",
  "getOpsSnapshot",
  "searchClasses",
]);

/**
 * People-directory / staff-directory intent (module: people).
 * Catches paraphrases like "current staff details" that previously
 * bypassed a narrow "people" keyword check via searchTeachers.
 */
const PEOPLE_DIRECTORY_PATTERNS: RegExp[] = [
  /\b(people|persons?)\b/i,
  /\b(staff|personnel|employees?)\b/i,
  /\b(user|users)\s+(directory|list|details|summary)\b/i,
  /\b(directory|list|summary|details|overview|info(?:rmation)?)\b.{0,48}\b(teachers?|staff|people|personnel|employees?)\b/i,
  /\b(teachers?|staff|people|personnel|employees?)\b.{0,48}\b(directory|list|summary|details|overview|info(?:rmation)?)\b/i,
  /\b(all|current|every|entire)\b.{0,24}\b(teachers?|staff|people|personnel|employees?)\b/i,
  /\blist\s+(all\s+)?teachers?\b/i,
  /\bteachers?\s+directory\b/i,
];

/** Class-scoped teaching questions may still use searchTeachers with Classes. */
const PEOPLE_ROSTER_EXCEPTION_RE =
  /\b(who teaches|teaches|teaching\s+(this|the|a|an|for)|teaching assignment|assigned to|class roster|timetable|for\s+year|year\s+\d+|term\s+\d+)\b/i;

/** Tools that must not stand in for the People directory. */
const PEOPLE_SUBSTITUTE_TOOLS = new Set([
  "searchTeachers",
  "searchStudents",
  "getClassRoster",
  "searchEnquiries",
  "getEnquiryPipelineSummary",
  "getOpsSnapshot",
]);

function asTrimmed(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * True when searchTeachers was called as an unscoped dump (no class filters).
 * That is effectively a people/staff directory listing.
 */
export function isUnscopedTeacherDirectoryQuery(
  args: Record<string, unknown> | null | undefined,
): boolean {
  if (!args) return true;
  return !(
    asTrimmed(args.subject) ||
    asTrimmed(args.yearLevel) ||
    asTrimmed(args.term) ||
    asTrimmed(args.academicYear)
  );
}

/**
 * True when the user is asking about enrolments/enrollments and did not
 * also mention enquiries/inquiries/leads.
 */
export function messageRequestsEnrolments(
  message: string | null | undefined,
): boolean {
  if (!message?.trim()) return false;
  const text = message.toLowerCase();
  return ENROLMENT_INTENT_RE.test(text) && !ENQUIRY_INTENT_RE.test(text);
}

export function messageRequestsSyllabus(
  message: string | null | undefined,
): boolean {
  if (!message?.trim()) return false;
  return SYLLABUS_INTENT_RE.test(message.toLowerCase());
}

export function messageRequestsPeopleDirectory(
  message: string | null | undefined,
): boolean {
  if (!message?.trim()) return false;
  const text = message.toLowerCase();
  // Enrolment questions are never People-directory intent.
  if (messageRequestsEnrolments(text)) return false;
  if (PEOPLE_ROSTER_EXCEPTION_RE.test(text)) {
    // Still treat pure staff/people directory wording as People even if
    // a year/term word appears elsewhere, when the ask is clearly directory.
    const strongDirectory =
      /\b(people|staff details|staff list|staff summary|personnel|employees?)\b/i.test(
        text,
      ) ||
      /\b(list|summary|details)\b.{0,24}\b(staff|people)\b/i.test(text) ||
      /\b(staff|people)\b.{0,24}\b(list|summary|details)\b/i.test(text);
    if (!strongDirectory) return false;
  }
  return PEOPLE_DIRECTORY_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Prevent Enquiries/ops tools from being used as a stand-in for Enrolments.
 */
export function assertNoEnquirySubstituteForEnrolmentIntent(
  actor: AdminAiActor,
  toolName: string,
  userMessage: string | null | undefined,
) {
  if (!ENROLMENT_SUBSTITUTE_TOOLS.has(toolName)) return;
  if (!messageRequestsEnrolments(userMessage)) return;

  if (!canUseAdminAiModule(actor, "enrolments")) {
    throw new AppError(
      403,
      "You do not have permission to access Enrolments. Enquiries or ops snapshot data cannot be used as a substitute.",
      "ADMIN_AI_MODULE_FORBIDDEN",
    );
  }

  throw new AppError(
    400,
    "This question is about enrolments and the user HAS Enrolments access. Call searchEnrolments or getPendingEnrollmentSummary now — do not refuse and do not use enquiry/ops tools.",
    "ADMIN_AI_WRONG_ENTITY",
  );
}

/**
 * Prevent Subjects/ops tools from answering syllabus questions, and stop
 * false "no access" refusals when Syllabus is ALLOWED.
 */
export function assertNoSubstituteForSyllabusIntent(
  actor: AdminAiActor,
  toolName: string,
  userMessage: string | null | undefined,
) {
  if (
    toolName === "listSyllabi" ||
    toolName === "searchAuthorizedSyllabusDocuments"
  ) {
    return;
  }
  if (!SYLLABUS_SUBSTITUTE_TOOLS.has(toolName)) return;
  if (!messageRequestsSyllabus(userMessage)) return;

  if (!canUseAdminAiModule(actor, "syllabus")) {
    throw new AppError(
      403,
      "You do not have permission to access Syllabus. Subjects catalogue data cannot be used as a substitute.",
      "ADMIN_AI_MODULE_FORBIDDEN",
    );
  }

  throw new AppError(
    400,
    "This question is about syllabus/curriculum and the user HAS Syllabus access. Call listSyllabi or searchAuthorizedSyllabusDocuments now — do not refuse and do not use listSubjects alone.",
    "ADMIN_AI_WRONG_ENTITY",
  );
}

function denyPeopleSubstitute(actor: AdminAiActor) {
  if (!canUseAdminAiModule(actor, "people")) {
    throw new AppError(
      403,
      "You do not have permission to access People. Class teacher or enrolment lists cannot be used as a substitute.",
      "ADMIN_AI_MODULE_FORBIDDEN",
    );
  }

  throw new AppError(
    400,
    "This question is about the People directory. Use searchPeople — not class roster or enrolment tools.",
    "ADMIN_AI_WRONG_ENTITY",
  );
}

/**
 * Prevent Classes/Enquiries tools from answering People-directory
 * questions when the user lacks the People module (or force searchPeople).
 */
export function assertNoSubstituteForPeopleIntent(
  actor: AdminAiActor,
  toolName: string,
  userMessage: string | null | undefined,
  toolArgs?: Record<string, unknown> | null,
) {
  if (toolName === "searchPeople") return;

  // Unscoped teacher dumps are a People-directory listing even without
  // the words "people"/"staff" in the prompt.
  if (
    toolName === "searchTeachers" &&
    isUnscopedTeacherDirectoryQuery(toolArgs) &&
    !canUseAdminAiModule(actor, "people")
  ) {
    throw new AppError(
      403,
      "You do not have permission to access People. Ask for a class, subject, year, or term to look up teaching assignments, or ask an administrator for People access.",
      "ADMIN_AI_MODULE_FORBIDDEN",
    );
  }

  if (!PEOPLE_SUBSTITUTE_TOOLS.has(toolName)) return;
  if (!messageRequestsPeopleDirectory(userMessage)) return;
  denyPeopleSubstitute(actor);
}

/** Run all cross-module substitution guards before tool execution. */
export function assertNoCrossModuleSubstitutes(
  actor: AdminAiActor,
  toolName: string,
  userMessage: string | null | undefined,
  toolArgs?: Record<string, unknown> | null,
) {
  assertNoEnquirySubstituteForEnrolmentIntent(actor, toolName, userMessage);
  assertNoSubstituteForSyllabusIntent(actor, toolName, userMessage);
  assertNoSubstituteForPeopleIntent(actor, toolName, userMessage, toolArgs);
}

/** Map OPEN_PAGE resources to the module required to show the deep link. */
export const ADMIN_AI_PAGE_MODULES: Record<string, AdminModuleId> = {
  dashboard: "dashboard",
  classes: "classes",
  calendar: "classes",
  attendance: "attendance",
  assessments: "classes",
  assessment: "classes",
  homework: "classes",
  learning: "classes",
  enrolments: "enrolments",
  enrolment: "enrolments",
  enquiries: "enquiries",
  enquiry: "enquiries",
  tasks: "tasks",
  people: "people",
  person: "people",
  subjects: "subjects",
  terms: "terms",
  syllabus: "syllabus",
  holidays: "settings",
  classrooms: "settings",
  "change-history": "change-history",
  "institution-settings": "settings",
  "ai-settings": "settings",
  "ai-usage": "settings",
};

export function canOpenAdminAiPage(
  actor: AdminAiActor,
  resource: string,
): boolean {
  const moduleId = ADMIN_AI_PAGE_MODULES[resource];
  if (!moduleId) return actor.role === UserRole.SUPER_ADMIN;
  // Dashboard deep link is ok for any Admin AI actor with at least one module.
  if (moduleId === "dashboard") return true;
  return canUseAdminAiModule(actor, moduleId);
}

/** Build a clear per-turn access block (authoritative over earlier chat turns). */
export function formatModuleAccessGuidance(actor: AdminAiActor): string {
  if (actor.role === UserRole.SUPER_ADMIN) {
    return "Access scope: Super Admin — all admin modules.";
  }

  const allowed = ADMIN_MODULES.filter((module) =>
    canUseAdminAiModule(actor, module.id),
  );
  const denied = ADMIN_MODULES.filter(
    (module) => !canUseAdminAiModule(actor, module.id),
  );

  if (allowed.length === 0) {
    return [
      "Access scope: no admin modules assigned.",
      "You cannot look up school data. Tell the user to ask an administrator to grant module access.",
    ].join("\n");
  }

  const statusLine = (id: AdminModuleId, guidance: string) => {
    const label =
      ADMIN_MODULES.find((module) => module.id === id)?.label ?? id;
    if (canUseAdminAiModule(actor, id)) {
      return `${label}: ALLOWED. ${guidance}`;
    }
    return `${label}: DENIED. Refuse questions about this module. Do not substitute another module.`;
  };

  const lines = [
    `Access scope for THIS turn (authoritative — ignore earlier permission refusals in this chat): ${allowed.map((m) => m.label).join(", ")}.`,
    "Critical: Never say you lack access to an ALLOWED module. Call the matching tool instead.",
    "Only use tools for ALLOWED modules.",
    statusLine(
      "enrolments",
      "For enrolment/enrollment questions call searchEnrolments or getPendingEnrollmentSummary.",
    ),
    statusLine(
      "enquiries",
      "For enquiry/lead/pipeline questions call searchEnquiries or getEnquiryPipelineSummary.",
    ),
    statusLine(
      "people",
      "For people/staff directory questions call searchPeople.",
    ),
    statusLine(
      "subjects",
      "For subject catalogue questions call listSubjects.",
    ),
    statusLine(
      "syllabus",
      "For syllabus/curriculum questions call listSyllabi (catalogue) or searchAuthorizedSyllabusDocuments (document text). Subjects ≠ Syllabus.",
    ),
    statusLine(
      "classes",
      "For classes/timetable/roster questions use the classes tools.",
    ),
    statusLine(
      "attendance",
      "For attendance questions use the attendance tools.",
    ),
    statusLine("terms", "For terms questions call listTerms."),
    statusLine("tasks", "For tasks questions use the tasks tools."),
    statusLine("reports", "For PDF/report requests use previewReport."),
    statusLine("settings", "For institution settings use settings tools."),
    statusLine(
      "change-history",
      "For audit/change history call searchChangeHistory.",
    ),
  ];

  if (
    canUseAdminAiModule(actor, "enrolments") &&
    canUseAdminAiModule(actor, "enquiries")
  ) {
    lines.push(
      "If the user asks for both enquiries and enrolments, call searchEnquiries AND searchEnrolments. Do not refuse either.",
    );
  }

  if (denied.length > 0) {
    lines.push(`Denied modules: ${denied.map((m) => m.label).join(", ")}.`);
  }

  lines.push(
    "Enrolments and Enquiries are separate. Subjects and Syllabus are separate. People is separate from Classes.",
    "searchTeachers is only for class-scoped questions (subject/year/term / who teaches).",
  );

  return lines.join("\n");
}
