import { UserRole, UserStatus } from "../../../../common/constants/roles.js";
import { ADMIN_AI_REPORT_TYPES } from "../reports/report.types.js";
import { normalizeQueryText } from "./text.js";

export type FieldKind =
  | "name"
  | "role"
  | "status"
  | "yearLevel"
  | "term"
  | "subject"
  | "academicYear"
  | "reportType"
  | "generic";

export type SectionDefinition = {
  id: string;
  /** Tools that belong to this section. */
  tools: string[];
  /** Natural-language aliases for the section/entity. */
  aliases: string[];
  /** Extra noise words specific to this section (stripped from name fields). */
  noise?: string[];
};

/** Build alias → canonical map (normalized lowercase keys). */
export function buildAliasMap(
  entries: Array<{ canonical: string; aliases: string[] }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of entries) {
    const all = [entry.canonical, ...entry.aliases];
    for (const alias of all) {
      const key = normalizeQueryText(alias);
      if (key) out[key] = entry.canonical;
    }
  }
  return out;
}

export const SECTION_REGISTRY: SectionDefinition[] = [
  {
    id: "people",
    tools: ["searchPeople"],
    aliases: [
      "people",
      "person",
      "directory",
      "users",
      "application owner",
      "application owners",
      "app owner",
      "owner",
      "staff",
      "teachers",
      "guardians",
      "students",
    ],
    noise: [
      "application",
      "app",
      "owner",
      "owners",
      "super",
      "admin",
      "teacher",
      "teachers",
      "staff",
      "guardian",
      "guardians",
      "student",
      "students",
      "parent",
      "parents",
      "tutor",
      "tutors",
    ],
  },
  {
    id: "teachers",
    tools: ["searchTeachers"],
    aliases: ["teacher", "teachers", "tutor", "tutors", "teaching roster"],
    noise: ["teacher", "teachers", "tutor", "tutors", "assigned"],
  },
  {
    id: "students",
    tools: ["searchStudents", "getClassRoster", "getLowAttendanceStudents"],
    aliases: ["student", "students", "learner", "learners", "pupil", "pupils"],
    noise: ["student", "students", "learner", "learners"],
  },
  {
    id: "classes",
    tools: ["searchClasses", "getLowAttendanceClasses"],
    aliases: ["class", "classes", "classroom group"],
    noise: ["class", "classes"],
  },
  {
    id: "subjects",
    tools: ["listSubjects"],
    aliases: ["subject", "subjects", "course", "courses"],
    noise: ["subject", "subjects", "course", "courses"],
  },
  {
    id: "terms",
    tools: ["listTerms", "getTermClassSchedule"],
    aliases: ["term", "terms", "semester", "semesters"],
    noise: ["term", "terms", "semester", "semesters"],
  },
  {
    id: "enrolments",
    tools: ["searchEnrolments", "getPendingEnrollmentSummary"],
    aliases: [
      "enrolment",
      "enrolments",
      "enrollment",
      "enrollments",
      "enrolled",
    ],
    noise: ["enrolment", "enrolments", "enrollment", "enrollments"],
  },
  {
    id: "enquiries",
    tools: ["searchEnquiries", "getEnquiryPipelineSummary"],
    aliases: ["enquiry", "enquiries", "inquiry", "inquiries", "lead", "leads"],
    noise: ["enquiry", "enquiries", "inquiry", "inquiries", "lead", "leads"],
  },
  {
    id: "tasks",
    tools: ["listOpenTasks", "getOpenTasksSummary"],
    aliases: ["task", "tasks", "todo", "todos"],
    noise: ["task", "tasks", "todo", "todos", "open"],
  },
  {
    id: "assessments",
    tools: ["listAssessments", "getAcademicPerformanceSummary"],
    aliases: ["assessment", "assessments", "exam", "exams", "test", "tests"],
    noise: ["assessment", "assessments", "exam", "exams"],
  },
  {
    id: "homework",
    tools: ["listHomework", "getPendingHomeworkSummary"],
    aliases: ["homework", "assignment", "assignments"],
    noise: ["homework", "assignment", "assignments"],
  },
  {
    id: "sessions",
    tools: ["listSessions", "getTodayTimetable", "getTodaysAbsences"],
    aliases: ["session", "sessions", "timetable", "schedule", "absences"],
    noise: ["session", "sessions", "timetable", "schedule", "today"],
  },
  {
    id: "attendance",
    tools: [
      "getAttendanceSummary",
      "getLowAttendanceStudents",
      "getLowAttendanceClasses",
      "getTodaysAbsences",
    ],
    aliases: ["attendance", "absent", "absences", "present"],
    noise: ["attendance", "absent", "absences", "present", "low"],
  },
  {
    id: "reports",
    tools: ["previewReport", "updateReportPreview", "generateReport"],
    aliases: ["report", "reports", "pdf", "export"],
    noise: ["report", "reports", "pdf", "export", "generate", "download"],
  },
  {
    id: "classrooms",
    tools: ["listClassrooms"],
    aliases: ["classroom", "classrooms", "room", "rooms"],
    noise: ["classroom", "classrooms", "room", "rooms"],
  },
  {
    id: "syllabi",
    tools: ["listSyllabi", "searchAuthorizedSyllabusDocuments"],
    aliases: ["syllabus", "syllabi", "curriculum"],
    noise: ["syllabus", "syllabi", "curriculum", "document", "documents"],
  },
  {
    id: "change_history",
    tools: ["searchChangeHistory"],
    aliases: ["change history", "audit", "activity log", "changes"],
    noise: ["change", "history", "audit", "activity", "log", "changes"],
  },
];

export const ROLE_ALIAS_MAP = buildAliasMap([
  {
    canonical: UserRole.SUPER_ADMIN,
    aliases: [
      "application owner",
      "application owners",
      "app owner",
      "app owners",
      "owner",
      "owners",
      "super admin",
      "superadmin",
      "admin",
      "application_owner",
      "SUPER_ADMIN",
    ],
  },
  {
    canonical: UserRole.OFFICE_STAFF,
    aliases: [
      "staff",
      "staffs",
      "office",
      "office staff",
      "OFFICE_STAFF",
    ],
  },
  {
    canonical: UserRole.STAFF,
    aliases: ["teacher", "teachers", "tutor", "tutors", "STAFF"],
  },
  {
    canonical: UserRole.STUDENT,
    aliases: ["student", "students", "learner", "learners", "STUDENT"],
  },
  {
    canonical: UserRole.GUARDIAN,
    aliases: [
      "guardian",
      "guardians",
      "parent",
      "parents",
      "carer",
      "GUARDIAN",
    ],
  },
]);

export const STATUS_ALIAS_MAP = buildAliasMap([
  {
    canonical: UserStatus.ACTIVE,
    aliases: ["active", "enabled", "live"],
  },
  {
    canonical: UserStatus.INVITED,
    aliases: ["invited", "invite", "pending invite"],
  },
  {
    canonical: UserStatus.DEACTIVATED,
    aliases: ["deactivated", "inactive", "disabled", "suspended"],
  },
  {
    canonical: "OPEN",
    aliases: ["open", "todo", "pending", "incomplete"],
  },
  {
    canonical: "DONE",
    aliases: ["done", "complete", "completed", "closed", "finished"],
  },
  {
    canonical: "ALL",
    aliases: ["all", "any"],
  },
]);

export const REPORT_TYPE_ALIAS_MAP = buildAliasMap(
  ADMIN_AI_REPORT_TYPES.map((type) => ({
    canonical: type,
    aliases: [
      type,
      type.replace(/_/g, " "),
      type.toLowerCase(),
      ...(type === "ENROLMENTS"
        ? ["enrolment", "enrollment", "enrollments", "enrolments report"]
        : []),
      ...(type === "ENQUIRIES"
        ? ["enquiry", "inquiry", "enquiries report", "inquiries"]
        : []),
      ...(type === "ATTENDANCE_SUMMARY"
        ? ["attendance", "attendance summary", "attendance report"]
        : []),
      ...(type === "LOW_ATTENDANCE_STUDENTS"
        ? [
            "low attendance",
            "low attendance students",
            "student attendance",
            "poor attendance",
          ]
        : []),
      ...(type === "LOW_ATTENDANCE_CLASSES"
        ? ["low attendance classes", "class attendance"]
        : []),
      ...(type === "ASSESSMENTS"
        ? ["assessment", "assessments", "exams", "exam report"]
        : []),
      ...(type === "TIMETABLE"
        ? ["timetable", "schedule", "class schedule"]
        : []),
      ...(type === "TASKS" ? ["task", "tasks", "open tasks"] : []),
    ],
  })),
);

export const YEAR_LEVEL_ALIAS_MAP = buildAliasMap(
  Array.from({ length: 13 }, (_, i) => {
    const n = String(i);
    return {
      canonical: `Year ${n}`,
      aliases: [
        `year ${n}`,
        `yr ${n}`,
        `y${n}`,
        `grade ${n}`,
        n,
        `year${n}`,
      ],
    };
  }),
);

export const TERM_ALIAS_MAP = buildAliasMap(
  [1, 2, 3, 4].map((n) => ({
    canonical: `Term ${n}`,
    aliases: [`term ${n}`, `t${n}`, `semester ${n}`, `sem ${n}`, `term${n}`],
  })),
);

export function sectionForTool(toolName: string): SectionDefinition | null {
  return SECTION_REGISTRY.find((section) => section.tools.includes(toolName)) ?? null;
}

/** Name-like arg keys cleaned across tools. */
export const NAME_ARG_KEYS = [
  "name",
  "studentName",
  "teacherName",
  "guardianName",
  "className",
  "actorName",
  "topic",
  "query",
] as const;
