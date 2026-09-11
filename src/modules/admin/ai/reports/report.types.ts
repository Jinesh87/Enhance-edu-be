import type { AdminModuleId } from "../../../../common/constants/modules.js";

export const ADMIN_AI_REPORT_TYPES = [
  "ATTENDANCE_SUMMARY",
  "LOW_ATTENDANCE_STUDENTS",
  "LOW_ATTENDANCE_CLASSES",
  "ENROLMENTS",
  "ENQUIRIES",
  "ASSESSMENTS",
  "TIMETABLE",
  "TASKS",
  "TEACHERS",
] as const;

export type AdminAiReportType = (typeof ADMIN_AI_REPORT_TYPES)[number];

export const REPORT_MAX_ROWS = 200;
/** Rows shown in chat preview (full set still used for PDF within REPORT_MAX_ROWS). */
export const REPORT_PREVIEW_ROWS = 30;

export type AdminAiReportFilters = {
  startDate?: string | null;
  endDate?: string | null;
  yearLevel?: string | null;
  term?: string | null;
  subject?: string | null;
  threshold?: number | null;
  status?: string | null;
  academicYear?: string | null;
  /** Optional person name scope (student / enquiry student / teacher). */
  studentName?: string | null;
};

export type ReportTablePayload = {
  title: string;
  filterLabels: string[];
  summary: Array<{ label: string; value: string }>;
  columns: string[];
  rows: string[][];
  truncated: boolean;
  totalMatched?: number;
  /** All safe columns that can be selected for this report type. */
  availableColumns?: string[];
};

/** Requests that must never appear as report columns. */
export function isBlockedReportColumnRequest(raw: string): boolean {
  const value = raw.trim().toLowerCase();
  if (!value) return false;
  return (
    /\b(email|e-mail|phone|mobile|telephone|password|passwd|secret|token|api\s*key|fee|fees|tuition|address|street|suburb|postcode|postal|dob|date\s*of\s*birth|ssn|passport|credit\s*card|bank)\b/i.test(
      value,
    ) || value.includes("@")
  );
}

/** Map user/LLM column phrases onto allowlisted column labels. */
export function resolveReportColumnLabel(
  requested: string,
  available: string[],
): string | null {
  const raw = requested.trim().toLowerCase();
  if (!raw || !available.length) return null;

  const exact = available.find((col) => col.toLowerCase() === raw);
  if (exact) return exact;

  const synonyms: Record<string, string[]> = {
    guardian: ["guardian", "guardians", "guardian details", "guardian name", "parent", "parents", "parent name", "carer"],
    student: ["student", "students", "student name", "learner"],
    subjects: ["subjects", "subject", "courses"],
    subject: ["subject", "subjects", "courses"],
    status: ["status", "enrolment status", "enrollment status"],
    year: [
      "year",
      "year level",
      "grade",
      "responsible year",
      "assigned year",
      "years",
    ],
    term: ["term", "semester", "responsible term", "assigned term", "terms"],
    owner: ["owner", "assigned to", "staff owner"],
    stage: ["stage", "pipeline stage"],
    rate: ["rate", "attendance rate", "attendance %", "percent"],
    class: ["class", "class name"],
    teacher: ["teacher", "tutor", "name"],
    "preferred name": ["preferred name", "preferred", "nickname"],
    role: ["role"],
    employment: ["employment", "employment type", "contract"],
    task: ["task", "tasks", "title"],
    due: ["due", "due date"],
  };

  for (const col of available) {
    const key = col.toLowerCase();
    const aliasList = synonyms[key] ?? [];
    if (aliasList.some((alias) => raw === alias || raw.includes(alias))) {
      return col;
    }
    if (raw.includes(key) || key.includes(raw)) {
      return col;
    }
  }
  return null;
}

export const REPORT_MODULE: Record<AdminAiReportType, AdminModuleId> = {
  ATTENDANCE_SUMMARY: "attendance",
  LOW_ATTENDANCE_STUDENTS: "attendance",
  LOW_ATTENDANCE_CLASSES: "attendance",
  ENROLMENTS: "enrolments",
  ENQUIRIES: "enquiries",
  ASSESSMENTS: "classes",
  TIMETABLE: "classes",
  TASKS: "tasks",
  TEACHERS: "people",
};

export function isAdminAiReportType(value: string): value is AdminAiReportType {
  return (ADMIN_AI_REPORT_TYPES as readonly string[]).includes(value);
}

export function reportTypeLabel(type: AdminAiReportType): string {
  switch (type) {
    case "ATTENDANCE_SUMMARY":
      return "Attendance Summary";
    case "LOW_ATTENDANCE_STUDENTS":
      return "Low Attendance Students";
    case "LOW_ATTENDANCE_CLASSES":
      return "Low Attendance Classes";
    case "ENROLMENTS":
      return "Enrolments";
    case "ENQUIRIES":
      return "Enquiries";
    case "ASSESSMENTS":
      return "Assessments";
    case "TIMETABLE":
      return "Timetable";
    case "TASKS":
      return "Tasks";
    case "TEACHERS":
      return "Teachers";
  }
}
