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
};

export type ReportTablePayload = {
  title: string;
  filterLabels: string[];
  summary: Array<{ label: string; value: string }>;
  columns: string[];
  rows: string[][];
  truncated: boolean;
  totalMatched?: number;
};

export const REPORT_MODULE: Record<AdminAiReportType, AdminModuleId> = {
  ATTENDANCE_SUMMARY: "attendance",
  LOW_ATTENDANCE_STUDENTS: "attendance",
  LOW_ATTENDANCE_CLASSES: "attendance",
  ENROLMENTS: "enrolments",
  ENQUIRIES: "enquiries",
  ASSESSMENTS: "classes",
  TIMETABLE: "classes",
  TASKS: "tasks",
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
  }
}
