import { Class } from "../../../../entities/Class.js";
import { UserRole, UserStatus } from "../../../../common/constants/roles.js";
import {
  assertAdminAiModule,
  type AdminAiActor,
} from "../authorization.js";
import { sanitizeToolPayload } from "../sanitize.js";
import {
  adminAiRepository,
  type TeacherClassFilters,
} from "../admin-ai.repository.js";
import {
  LIST_MAX_ROWS,
  MAX_ROWS,
  type ToolResult,
} from "../tool-helpers.js";

type TeacherAssignmentRow = {
  teacherName: string;
  subject: string | null;
  yearLevel: string | null;
  term: string | null;
  academicYear: string | null;
};

function teacherAssignmentFromClass(cls: Class): TeacherAssignmentRow | null {
  const name = cls.teacher?.fullName?.trim();
  if (!name) return null;
  return {
    teacherName: name,
    subject: (cls.subject ?? cls.name ?? "").trim() || null,
    yearLevel: cls.term?.yearLevel?.name ?? null,
    term: cls.term?.name ?? cls.termName ?? null,
    academicYear: cls.term?.academicYear
      ? String(cls.term.academicYear.year)
      : null,
  };
}

/** Unique teacher assignments (not sessions/days). */
function dedupeTeacherAssignments(rows: TeacherAssignmentRow[]) {
  const seen = new Set<string>();
  const out: TeacherAssignmentRow[] = [];
  for (const row of rows) {
    const key = [
      row.teacherName.toLowerCase(),
      (row.subject ?? "").toLowerCase(),
      (row.yearLevel ?? "").toLowerCase(),
      (row.term ?? "").toLowerCase(),
      row.academicYear ?? "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out.slice(0, MAX_ROWS);
}

function describeTeacherFilters(filters: TeacherClassFilters) {
  return [filters.yearLevel, filters.term, filters.subject, filters.teacherName]
    .filter(Boolean)
    .join(", ");
}

/**
 * Teacher list search: unique assigned teachers by academic assignment.
 * Does not expand into sessions/days. Excludes unassigned classes from teacher rows.
 */
export async function searchTeachers(
  actor: AdminAiActor,
  args: {
    subject?: string;
    teacherName?: string;
    yearLevel?: string;
    term?: string;
    academicYear?: string;
  },
): Promise<ToolResult> {
  assertAdminAiModule(actor, "classes");

  const subject = args.subject?.trim() || null;
  const teacherName = args.teacherName?.trim() || null;
  const yearLevel = args.yearLevel?.trim() || null;
  const term = args.term?.trim() || null;
  const academicYear = args.academicYear?.trim() || null;

  const filters: TeacherClassFilters = {
    subject,
    teacherName,
    yearLevel,
    term,
    academicYear,
  };

  const classes = await adminAiRepository.findTeacherClasses(filters);
  const teachers = dedupeTeacherAssignments(
    classes
      .map(teacherAssignmentFromClass)
      .filter((row): row is TeacherAssignmentRow => row !== null),
  );

  const filterLabel = describeTeacherFilters(filters) || "all teachers";
  const hasUnassignedExact =
    classes.length > 0 &&
    teachers.length === 0 &&
    Boolean(subject || yearLevel || term);

  if (teachers.length > 0) {
    return {
      data: sanitizeToolPayload({
        entity: "teacher",
        matchLevel: "exact",
        filtersApplied: filters,
        teacherCount: teachers.length,
        teachers,
        columns: ["Teacher", "Subject", "Year", "Term"],
        responseHint:
          "Entity is teachers (unique assignments). Table columns only: Teacher | Subject | Year | Term. One row per teacher+subject+year+term. Never list days, sessions, class codes, or times unless the user asked for sessions.",
      }),
      sources: [
        {
          kind: "database",
          label: "Teacher assignments",
          detail: filterLabel,
        },
      ],
    };
  }

  // Exact filters had classes but no assigned teacher.
  let relatedNote: string | null = null;
  let relatedTeachers: TeacherAssignmentRow[] = [];

  if (hasUnassignedExact && (subject || teacherName)) {
    const relatedClasses = await adminAiRepository.findTeacherClasses({
      subject,
      teacherName,
      yearLevel: null,
      term: null,
      academicYear: null,
    });
    relatedTeachers = dedupeTeacherAssignments(
      relatedClasses
        .map(teacherAssignmentFromClass)
        .filter((row): row is TeacherAssignmentRow => row !== null),
    );
    if (relatedTeachers.length > 0) {
      relatedNote = `Related: ${relatedTeachers.length} assigned teacher(s) exist for the same subject in other years/terms.`;
    }
  }

  if (hasUnassignedExact) {
    return {
      data: sanitizeToolPayload({
        entity: "teacher",
        matchLevel: "none",
        filtersApplied: filters,
        teacherCount: 0,
        teachers: [],
        unassignedExact: true,
        exactNote: `No teacher is assigned to ${filterLabel}.`,
        relatedNote,
        relatedTeachers: relatedTeachers.slice(0, 8),
        responseHint:
          "Say no teacher is assigned for the requested filters. Do not list Unassigned as a teacher. Optionally add one short related note if relatedTeachers is present — do not replace the answer with other terms.",
      }),
      sources: [
        {
          kind: "database",
          label: "Teacher assignments",
          detail: `${filterLabel} · unassigned`,
        },
      ],
    };
  }

  // No classes matched the filters — try subject-only related note when year/term were specified.
  if ((yearLevel || term || academicYear) && (subject || teacherName)) {
    const relatedClasses = await adminAiRepository.findTeacherClasses({
      subject,
      teacherName,
      yearLevel: null,
      term: null,
      academicYear: null,
    });
    relatedTeachers = dedupeTeacherAssignments(
      relatedClasses
        .map(teacherAssignmentFromClass)
        .filter((row): row is TeacherAssignmentRow => row !== null),
    );
    if (relatedTeachers.length > 0) {
      relatedNote = `Related: assigned teachers exist for the same subject in other years/terms.`;
    }
  }

  return {
    data: sanitizeToolPayload({
      entity: "teacher",
      matchLevel: "none",
      filtersApplied: filters,
      teacherCount: 0,
      teachers: [],
      exactNote: `No teachers found for ${filterLabel}.`,
      relatedNote,
      relatedTeachers: relatedTeachers.slice(0, 8),
      responseHint:
        "Say there are no matching teachers for the requested filters. Optionally one short related note if relatedTeachers is present. Do not invent rows.",
    }),
    sources: [
      {
        kind: "database",
        label: "Teacher assignments",
        detail: `${filterLabel} · none`,
      },
    ],
  };
}

type StudentSearchFilters = {
  studentName?: string | null;
  subject?: string | null;
  yearLevel?: string | null;
  term?: string | null;
  academicYear?: string | null;
};

/**
 * Unique enrolled students (ACTIVE enrolments), not class-session rows.
 */
export async function searchStudents(
  actor: AdminAiActor,
  args: {
    studentName?: string;
    subject?: string;
    yearLevel?: string;
    term?: string;
    academicYear?: string;
  },
): Promise<ToolResult> {
  assertAdminAiModule(actor, "enrolments");

  const studentName = args.studentName?.trim() || null;
  const subject = args.subject?.trim() || null;
  const yearLevel = args.yearLevel?.trim() || null;
  const term = args.term?.trim() || null;
  const academicYear = args.academicYear?.trim() || null;

  const filters: StudentSearchFilters = {
    studentName,
    subject,
    yearLevel,
    term,
    academicYear,
  };

  const enrollments =
    await adminAiRepository.findActiveEnrollmentsForStudentSearch(filters);
  const seen = new Set<string>();
  const students: Array<{
    studentName: string;
    yearLevel: string | null;
    term: string | null;
    subjects: string;
  }> = [];

  for (const enrollment of enrollments) {
    const name = enrollment.student?.fullName?.trim();
    if (!name) continue;
    const yl = enrollment.term?.yearLevel?.name ?? null;
    const termName = enrollment.term?.name ?? null;
    const subjectNames = (enrollment.subjects ?? [])
      .map((row) => row.subject?.name?.trim())
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => a.localeCompare(b));
    const key = `${enrollment.studentId}|${enrollment.termId}|${subjectNames.join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    students.push({
      studentName: name,
      yearLevel: yl,
      term: termName,
      subjects: subjectNames.join(", ") || "—",
    });
    if (students.length >= LIST_MAX_ROWS) break;
  }

  const filterLabel =
    [studentName, yearLevel, term, subject, academicYear]
      .filter(Boolean)
      .join(", ") || "all students";

  return {
    data: sanitizeToolPayload({
      entity: "student",
      matchLevel: students.length ? "exact" : "none",
      filtersApplied: filters,
      studentCount: students.length,
      truncated: enrollments.length >= 200 || students.length >= LIST_MAX_ROWS,
      students,
      columns: ["Student", "Year", "Term", "Subjects"],
      exactNote: students.length
        ? null
        : `No students found for ${filterLabel}.`,
      responseHint:
        "Entity is students (unique enrolments). Table: Student | Year | Term | Subjects. Never include emails, phones, fees, or IDs. Keep the answer short.",
    }),
    sources: [
      {
        kind: "database",
        label: "Student enrolments",
        detail: filterLabel,
      },
    ],
  };
}

/**
 * Unique classes (not session slots).
 */
export async function searchClasses(
  actor: AdminAiActor,
  args: {
    subject?: string;
    className?: string;
    yearLevel?: string;
    term?: string;
    academicYear?: string;
    teacherName?: string;
  },
): Promise<ToolResult> {
  assertAdminAiModule(actor, "classes");

  const subject = args.subject?.trim() || null;
  const className = args.className?.trim() || null;
  const yearLevel = args.yearLevel?.trim() || null;
  const term = args.term?.trim() || null;
  const academicYear = args.academicYear?.trim() || null;
  const teacherName = args.teacherName?.trim() || null;

  const classes = await adminAiRepository.findClassesForSearch({
    subject,
    className,
    yearLevel,
    term,
    academicYear,
    teacherName,
  });
  const seen = new Set<string>();
  const rows: Array<{
    className: string;
    subject: string | null;
    yearLevel: string | null;
    term: string | null;
    teacherName: string | null;
  }> = [];

  for (const cls of classes) {
    if (seen.has(cls.id)) continue;
    seen.add(cls.id);
    rows.push({
      className: cls.name,
      subject: (cls.subject ?? "").trim() || null,
      yearLevel: cls.term?.yearLevel?.name ?? null,
      term: cls.term?.name ?? cls.termName ?? null,
      teacherName: cls.teacher?.fullName?.trim() || null,
    });
    if (rows.length >= LIST_MAX_ROWS) break;
  }

  const filterLabel =
    [subject, className, yearLevel, term, teacherName, academicYear]
      .filter(Boolean)
      .join(", ") || "all classes";

  return {
    data: sanitizeToolPayload({
      entity: "class",
      matchLevel: rows.length ? "exact" : "none",
      filtersApplied: {
        subject,
        className,
        yearLevel,
        term,
        academicYear,
        teacherName,
      },
      classCount: rows.length,
      truncated: classes.length >= 200 || rows.length >= LIST_MAX_ROWS,
      classes: rows,
      columns: ["Class", "Subject", "Year", "Term", "Teacher"],
      exactNote: rows.length ? null : `No classes found for ${filterLabel}.`,
      responseHint:
        "Entity is classes (unique). Table: Class | Subject | Year | Term | Teacher. Do not expand into session days/times unless the user asked for sessions.",
    }),
    sources: [
      {
        kind: "database",
        label: "Classes",
        detail: filterLabel,
      },
    ],
  };
}

export async function listSubjects(
  actor: AdminAiActor,
  args: { yearLevel?: string; name?: string },
): Promise<ToolResult> {
  assertAdminAiModule(actor, "subjects");

  const yearLevel = args.yearLevel?.trim() || null;
  const name = args.name?.trim() || null;

  const subjects = await adminAiRepository.findSubjects({ yearLevel, name });
  const rows = subjects.map((subject) => ({
    subject: subject.name,
    yearLevel: subject.yearLevel?.name ?? null,
  }));

  return {
    data: sanitizeToolPayload({
      entity: "subject",
      matchLevel: rows.length ? "exact" : "none",
      subjectCount: rows.length,
      subjects: rows,
      columns: ["Subject", "Year"],
      exactNote: rows.length ? null : "No subjects found.",
      responseHint:
        "Entity is subjects. Table: Subject | Year. Keep the answer short.",
    }),
    sources: [
      {
        kind: "database",
        label: "Subjects",
        detail: [name, yearLevel].filter(Boolean).join(" · ") || "Catalogue",
      },
    ],
  };
}

export async function listTerms(
  actor: AdminAiActor,
  args: { yearLevel?: string; term?: string; academicYear?: string },
): Promise<ToolResult> {
  assertAdminAiModule(actor, "terms");

  const yearLevel = args.yearLevel?.trim() || null;
  const term = args.term?.trim() || null;
  const academicYear = args.academicYear?.trim() || null;

  const terms = await adminAiRepository.findTerms({
    yearLevel,
    term,
    academicYear,
  });
  const rows = terms.map((item) => ({
    term: item.name,
    yearLevel: item.yearLevel?.name ?? null,
    academicYear: item.academicYear ? String(item.academicYear.year) : null,
    startDate: item.startDate,
    endDate: item.endDate,
    isTrial: item.isTrial,
  }));

  return {
    data: sanitizeToolPayload({
      entity: "term",
      matchLevel: rows.length ? "exact" : "none",
      termCount: rows.length,
      terms: rows,
      columns: ["Term", "Year", "Academic Year", "Start", "End"],
      exactNote: rows.length ? null : "No terms found.",
      responseHint:
        "Entity is terms. Table: Term | Year | Academic Year | Start | End. Keep the answer short.",
    }),
    sources: [
      {
        kind: "database",
        label: "Terms",
        detail:
          [term, yearLevel, academicYear].filter(Boolean).join(" · ") ||
          "Catalogue",
      },
    ],
  };
}

/**
 * People directory: name, role, status only (no email/mobile).
 */
export async function searchPeople(
  actor: AdminAiActor,
  args: { name?: string; role?: string; status?: string },
): Promise<ToolResult> {
  assertAdminAiModule(actor, "people");

  const name = args.name?.trim() || null;
  const roleRaw = args.role?.trim().toUpperCase().replace(/\s+/g, "_") || null;
  const statusRaw = args.status?.trim().toUpperCase() || null;

  const roleAliases: Record<string, UserRole> = {
    SUPER_ADMIN: UserRole.SUPER_ADMIN,
    ADMIN: UserRole.SUPER_ADMIN,
    OFFICE_STAFF: UserRole.OFFICE_STAFF,
    OFFICE: UserRole.OFFICE_STAFF,
    STAFF: UserRole.STAFF,
    TEACHER: UserRole.STAFF,
    TEACHERS: UserRole.STAFF,
    STUDENT: UserRole.STUDENT,
    STUDENTS: UserRole.STUDENT,
    GUARDIAN: UserRole.GUARDIAN,
    GUARDIANS: UserRole.GUARDIAN,
    PARENT: UserRole.GUARDIAN,
  };

  const people = await adminAiRepository.findPeople({
    name,
    role: roleRaw && roleAliases[roleRaw] ? roleAliases[roleRaw] : null,
    status:
      statusRaw && Object.values(UserStatus).includes(statusRaw as UserStatus)
        ? (statusRaw as UserStatus)
        : null,
  });
  const rows = people.slice(0, LIST_MAX_ROWS).map((person) => ({
    name: person.fullName,
    role: person.role,
    status: person.status,
  }));

  const filterLabel =
    [name, roleRaw, statusRaw].filter(Boolean).join(", ") || "people";

  return {
    data: sanitizeToolPayload({
      entity: "person",
      matchLevel: rows.length ? "exact" : "none",
      peopleCount: rows.length,
      truncated: people.length > LIST_MAX_ROWS,
      people: rows,
      columns: ["Name", "Role", "Status"],
      exactNote: rows.length ? null : `No people found for ${filterLabel}.`,
      responseHint:
        "Entity is people. Table: Name | Role | Status. Never show emails, phones, usernames used as secrets, or IDs.",
    }),
    sources: [
      {
        kind: "database",
        label: "People",
        detail: filterLabel,
      },
    ],
  };
}

export async function listClassrooms(
  actor: AdminAiActor,
  args: { name?: string; activeOnly?: boolean },
): Promise<ToolResult> {
  assertAdminAiModule(actor, "settings");

  const name = args.name?.trim() || null;
  const activeOnly = args.activeOnly !== false;

  const classrooms = await adminAiRepository.findClassrooms({
    name,
    activeOnly,
  });
  const rows = classrooms.map((room) => ({
    name: room.name,
    code: room.code,
    capacity: room.capacity,
    active: room.isActive,
  }));

  return {
    data: sanitizeToolPayload({
      entity: "classroom",
      matchLevel: rows.length ? "exact" : "none",
      classroomCount: rows.length,
      classrooms: rows,
      columns: ["Name", "Code", "Capacity"],
      exactNote: rows.length ? null : "No classrooms found.",
      responseHint:
        "Entity is classrooms. Table: Name | Code | Capacity. Keep short.",
    }),
    sources: [
      {
        kind: "database",
        label: "Classrooms",
        detail: name || "Catalogue",
      },
    ],
  };
}

export async function listSyllabi(
  actor: AdminAiActor,
  args: { subject?: string; yearLevel?: string; term?: string; academicYear?: string },
): Promise<ToolResult> {
  assertAdminAiModule(actor, "syllabus");

  const subject = args.subject?.trim() || null;
  const yearLevel = args.yearLevel?.trim() || null;
  const term = args.term?.trim() || null;
  const academicYear = args.academicYear?.trim() || null;

  const syllabi = await adminAiRepository.findSyllabi({
    subject,
    yearLevel,
    term,
    academicYear,
  });
  const rows = syllabi.slice(0, LIST_MAX_ROWS).map((item) => ({
    title: item.title,
    subject: item.subject?.name ?? null,
    yearLevel: item.yearLevel?.name ?? null,
    term: item.appliesToAllTerms
      ? "All terms"
      : item.term?.name ?? null,
    academicYear: item.academicYear ? String(item.academicYear.year) : null,
  }));

  const filterLabel =
    [subject, yearLevel, term, academicYear].filter(Boolean).join(", ") ||
    "syllabi";

  return {
    data: sanitizeToolPayload({
      entity: "syllabus",
      matchLevel: rows.length ? "exact" : "none",
      syllabusCount: rows.length,
      truncated: syllabi.length > LIST_MAX_ROWS,
      syllabi: rows,
      columns: ["Title", "Subject", "Year", "Term", "Academic Year"],
      exactNote: rows.length
        ? null
        : `No syllabi found for ${filterLabel}.`,
      responseHint:
        "Entity is syllabus catalogue. Table: Title | Subject | Year | Term | Academic Year. For document content questions use searchAuthorizedSyllabusDocuments.",
    }),
    sources: [
      {
        kind: "database",
        label: "Syllabi",
        detail: filterLabel,
      },
    ],
  };
}
