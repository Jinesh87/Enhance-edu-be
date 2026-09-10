import {
  calendarDateInTimeZone,
} from "../../../../common/utils/timezone.js";
import { UserRole } from "../../../../common/constants/roles.js";
import {
  assertAdminAiModule,
  type AdminAiActor,
} from "../authorization.js";
import { sanitizeToolPayload } from "../sanitize.js";
import { adminAiRepository } from "../admin-ai.repository.js";
import {
  LIST_MAX_ROWS,
  clampRange,
  dayBoundsInClassTz,
  formatLocalSessionTime,
  openPageAction,
  type ToolResult,
} from "../tool-helpers.js";

/**
 * Enrolments list: ACTIVE enrolments and/or pending invitations (no fees/PII).
 */
export async function searchEnrolments(
  actor: AdminAiActor,
  args: {
    studentName?: string;
    status?: string;
    subject?: string;
    yearLevel?: string;
    term?: string;
    academicYear?: string;
  },
): Promise<ToolResult> {
  assertAdminAiModule(actor, "enrolments");

  const studentName = args.studentName?.trim() || null;
  const statusRaw = args.status?.trim().toUpperCase() || null;
  const subject = args.subject?.trim() || null;
  const yearLevel = args.yearLevel?.trim() || null;
  const term = args.term?.trim() || null;
  const academicYear = args.academicYear?.trim() || null;

  const wantPending =
    !statusRaw ||
    statusRaw === "PENDING" ||
    statusRaw.includes("PENDING") ||
    statusRaw === "ALL";
  const wantActive =
    !statusRaw ||
    statusRaw === "ACTIVE" ||
    statusRaw === "ENROLLED" ||
    statusRaw === "ALL";

  const rows: Array<{
    studentName: string;
    status: string;
    yearLevel: string | null;
    term: string | null;
    subjects: string;
  }> = [];
  const enrolmentIds: string[] = [];

  const enrolmentFilters = {
    studentName,
    subject,
    yearLevel,
    term,
    academicYear,
  };

  if (wantActive && statusRaw !== "PENDING") {
    const enrollments =
      await adminAiRepository.findActiveEnrollmentsForEnrolmentSearch(
        enrolmentFilters,
      );
    for (const enrollment of enrollments) {
      const name = enrollment.student?.fullName?.trim();
      if (!name) continue;
      const subjectNames = (enrollment.subjects ?? [])
        .map((row) => row.subject?.name?.trim())
        .filter((value): value is string => Boolean(value))
        .sort((a, b) => a.localeCompare(b));
      rows.push({
        studentName: name,
        status: "ACTIVE",
        yearLevel: enrollment.term?.yearLevel?.name ?? null,
        term: enrollment.term?.name ?? null,
        subjects: subjectNames.join(", ") || "—",
      });
      enrolmentIds.push(enrollment.id);
    }
  }

  if (wantPending) {
    const pendingList =
      await adminAiRepository.findPendingEnrollmentsForEnrolmentSearch(
        enrolmentFilters,
      );
    for (const pending of pendingList) {
      const name = pending.studentFullName?.trim();
      if (!name) continue;
      const subjectNames = (pending.subjects ?? [])
        .map((row) => row.subject?.name?.trim())
        .filter((value): value is string => Boolean(value))
        .sort((a, b) => a.localeCompare(b));
      rows.push({
        studentName: name,
        status: "PENDING",
        yearLevel:
          pending.term?.yearLevel?.name ??
          (pending.studentYearLevel != null
            ? `Year ${pending.studentYearLevel}`
            : null),
        term: pending.term?.name ?? null,
        subjects: subjectNames.join(", ") || "—",
      });
    }
  }

  const limited = rows.slice(0, LIST_MAX_ROWS);
  const filterLabel =
    [studentName, statusRaw, yearLevel, term, subject, academicYear]
      .filter(Boolean)
      .join(", ") || "enrolments";

  const actions = [
    openPageAction("enrolments", "Open Enrolments", {
      filters: { search: studentName, yearLevel },
    }),
  ];
  if (enrolmentIds.length === 1 && rows.length === 1) {
    actions.unshift(
      openPageAction("enrolment", "Open Enrolment", { id: enrolmentIds[0] }),
    );
  }

  return {
    data: sanitizeToolPayload({
      entity: "enrolment",
      matchLevel: limited.length ? "exact" : "none",
      enrolmentCount: limited.length,
      truncated: rows.length > LIST_MAX_ROWS,
      enrolments: limited,
      columns: ["Student", "Status", "Year", "Term", "Subjects"],
      exactNote: limited.length
        ? null
        : `No enrolments found for ${filterLabel}.`,
      responseHint:
        "Entity is enrolments. Table: Student | Status | Year | Term | Subjects. Never show fees, emails, phones, or IDs.",
    }),
    sources: [
      {
        kind: "database",
        label: "Enrolments",
        detail: filterLabel,
      },
    ],
    actions,
  };
}

/**
 * Enquiry list — names and stage only (no contact PII).
 */
export async function searchEnquiries(
  actor: AdminAiActor,
  args: {
    studentName?: string;
    guardianName?: string;
    stage?: string;
    subject?: string;
    yearLevel?: string;
  },
): Promise<ToolResult> {
  assertAdminAiModule(actor, "enquiries");

  const studentName = args.studentName?.trim() || null;
  const guardianName = args.guardianName?.trim() || null;
  const stage = args.stage?.trim() || null;
  const subject = args.subject?.trim() || null;
  const yearLevel = args.yearLevel?.trim() || null;

  const enquiries = await adminAiRepository.findEnquiries({
    studentName,
    guardianName,
    stage,
    subject,
    yearLevel,
  });
  const seen = new Set<string>();
  const rows: Array<{
    studentName: string | null;
    guardianName: string;
    stage: string | null;
    subject: string | null;
    yearLevel: string | null;
    owner: string | null;
  }> = [];

  for (const enquiry of enquiries) {
    if (seen.has(enquiry.id)) continue;
    seen.add(enquiry.id);
    rows.push({
      studentName: enquiry.studentFullName?.trim() || null,
      guardianName: enquiry.guardianFullName,
      stage: enquiry.currentStage?.name ?? null,
      subject: enquiry.subjectOfInterest?.trim() || null,
      yearLevel:
        enquiry.yearLevel != null ? `Year ${enquiry.yearLevel}` : null,
      owner: enquiry.owner?.fullName?.trim() || null,
    });
    if (rows.length >= LIST_MAX_ROWS) break;
  }

  const filterLabel =
    [studentName, guardianName, stage, subject, yearLevel]
      .filter(Boolean)
      .join(", ") || "enquiries";

  const enquiryIds = [...seen];
  const actions = [
    openPageAction("enquiries", "Open Enquiries", {
      filters: {
        search: studentName || guardianName,
        yearLevel,
        subject,
      },
    }),
  ];
  if (enquiryIds.length === 1 && rows.length === 1) {
    actions.unshift(
      openPageAction("enquiry", "Open Enquiry", { id: enquiryIds[0] }),
    );
  }

  return {
    data: sanitizeToolPayload({
      entity: "enquiry",
      matchLevel: rows.length ? "exact" : "none",
      enquiryCount: rows.length,
      truncated: enquiries.length >= 200 || rows.length >= LIST_MAX_ROWS,
      enquiries: rows,
      columns: ["Student", "Guardian", "Stage", "Subject", "Year", "Owner"],
      exactNote: rows.length
        ? null
        : `No enquiries found for ${filterLabel}.`,
      responseHint:
        "Entity is enquiries. Table: Student | Guardian | Stage | Subject | Year | Owner. Never show emails, phones, or IDs.",
    }),
    sources: [
      {
        kind: "database",
        label: "Enquiries",
        detail: filterLabel,
      },
    ],
    actions,
  };
}

export async function listOpenTasks(
  actor: AdminAiActor,
  args: { status?: string; studentName?: string },
): Promise<ToolResult> {
  assertAdminAiModule(actor, "tasks");

  const statusRaw = args.status?.trim().toUpperCase() || "OPEN";
  const studentName = args.studentName?.trim() || null;
  const status =
    statusRaw === "DONE" || statusRaw === "ALL" ? statusRaw : "OPEN";

  const tasks = await adminAiRepository.findTasks({ status, studentName });
  const rows = tasks.slice(0, LIST_MAX_ROWS).map((task) => {
    const due = formatLocalSessionTime(
      task.dueAt,
      task.dueAt,
      task.session?.class?.timeZone,
    );
    return {
      title: task.title,
      studentName: task.student?.fullName?.trim() || null,
      status: task.status,
      type: task.type,
      dueDate: calendarDateInTimeZone(
        task.dueAt,
        task.session?.class?.timeZone,
      ),
      dueTime: due.startTime,
      className: task.session?.class?.name ?? null,
    };
  });

  const truncated = tasks.length > LIST_MAX_ROWS;
  const exactOpenTotal =
    status === "OPEN" && !studentName
      ? await adminAiRepository.countOpenTasks()
      : null;

  return {
    data: sanitizeToolPayload({
      entity: "task",
      matchLevel: rows.length ? "exact" : "none",
      returnedCount: rows.length,
      totalMatched: exactOpenTotal ?? (truncated ? null : rows.length),
      truncated,
      tasks: rows,
      columns: ["Task", "Student", "Status", "Due", "Class"],
      exactNote: rows.length ? null : "No matching tasks.",
      responseHint:
        "Entity is tasks. Table: Task | Student | Status | Due | Class. Prefer totalMatched for counts when present. Keep short. No IDs.",
    }),
    sources: [
      {
        kind: "database",
        label: "Admin tasks",
        detail: status,
      },
    ],
    actions: [openPageAction("tasks", "Open Tasks")],
  };
}

export async function listAssessments(
  actor: AdminAiActor,
  args: {
    subject?: string;
    yearLevel?: string;
    term?: string;
    status?: string;
    name?: string;
  },
): Promise<ToolResult> {
  assertAdminAiModule(actor, "classes");

  const subject = args.subject?.trim() || null;
  const yearLevel = args.yearLevel?.trim() || null;
  const term = args.term?.trim() || null;
  const status = args.status?.trim().toUpperCase() || null;
  const name = args.name?.trim() || null;

  const assessments = await adminAiRepository.findAssessments({
    subject,
    yearLevel,
    term,
    status,
    name,
  });
  const rows = assessments.slice(0, LIST_MAX_ROWS).map((item) => ({
    name: item.name,
    subject: item.subject,
    yearLevel: item.yearGroup || item.term?.yearLevel?.name || null,
    term: item.term?.name ?? null,
    date: item.assessmentDate,
    startTime: item.startTime,
    status: item.status,
    teacherName: item.teacher?.fullName?.trim() || null,
  }));

  const filterLabel =
    [name, subject, yearLevel, term, status].filter(Boolean).join(", ") ||
    "assessments";

  const actions = [
    openPageAction("assessments", "Open Assessments", {
      filters: {
        yearLevel,
        term,
        year: assessments[0]?.term?.academicYear
          ? String(assessments[0].term.academicYear.year)
          : undefined,
      },
    }),
  ];
  if (assessments.length === 1) {
    actions.unshift(
      openPageAction("assessment", "Open Assessment", {
        id: assessments[0]!.id,
      }),
    );
  }

  return {
    data: sanitizeToolPayload({
      entity: "assessment",
      matchLevel: rows.length ? "exact" : "none",
      assessmentCount: rows.length,
      truncated: assessments.length > LIST_MAX_ROWS,
      assessments: rows,
      columns: ["Assessment", "Subject", "Year", "Term", "Date", "Status"],
      exactNote: rows.length
        ? null
        : `No assessments found for ${filterLabel}.`,
      responseHint:
        "Entity is assessments. Table: Assessment | Subject | Year | Term | Date | Status. No student marks or IDs.",
    }),
    sources: [
      {
        kind: "database",
        label: "Assessments",
        detail: filterLabel,
      },
    ],
    actions,
  };
}

/**
 * Session list for an explicit date range (default: today). Max 14 days.
 */
export async function listSessions(
  actor: AdminAiActor,
  args: {
    startDate?: string;
    endDate?: string;
    yearLevel?: string;
    subject?: string;
  },
): Promise<ToolResult> {
  assertAdminAiModule(actor, "classes");

  const yearLevel = args.yearLevel?.trim() || null;
  const subject = args.subject?.trim() || null;

  let start: Date;
  let end: Date;
  let label: string;

  if (!args.startDate && !args.endDate) {
    const day = dayBoundsInClassTz();
    start = day.start;
    end = day.end;
    label = day.label;
  } else {
    const range = clampRange(args.startDate, args.endDate);
    start = range.start;
    end = range.endExclusive;
    // Cap session listing to 14 days.
    const maxEnd = new Date(start);
    maxEnd.setUTCDate(maxEnd.getUTCDate() + 14);
    if (end > maxEnd) end = maxEnd;
    label = `${range.start.toISOString().slice(0, 10)}–${new Date(end.getTime() - 1).toISOString().slice(0, 10)}`;
  }

  const sessions = await adminAiRepository.findSessionsInRange(start, end, {
    yearLevel,
    subject,
  });
  const rows = sessions.slice(0, LIST_MAX_ROWS).map((session) => {
    const local = formatLocalSessionTime(
      session.startAt,
      session.endAt,
      session.class?.timeZone,
    );
    const teacher =
      session.teacher?.fullName?.trim() ||
      session.class?.teacher?.fullName?.trim() ||
      null;
    return {
      date: calendarDateInTimeZone(session.startAt, session.class?.timeZone),
      time: local.time,
      className:
        session.class?.name ??
        session.assessment?.name ??
        null,
      subject:
        session.class?.subject ??
        session.assessment?.subject ??
        null,
      yearLevel: session.class?.term?.yearLevel?.name ?? null,
      teacherName: teacher,
      room:
        session.classroom?.name ??
        session.room ??
        session.class?.room ??
        null,
    };
  });

  return {
    data: sanitizeToolPayload({
      entity: "session",
      matchLevel: rows.length ? "exact" : "none",
      dateRange: label,
      sessionCount: rows.length,
      truncated: sessions.length > LIST_MAX_ROWS,
      sessions: rows,
      columns: ["Date", "Time", "Class", "Subject", "Teacher", "Room"],
      exactNote: rows.length
        ? null
        : `No sessions found for ${label}.`,
      responseHint:
        "Entity is sessions. Table: Date | Time | Class | Subject | Teacher | Room. Use only when the user asked for sessions/timetable for dates.",
      displayNote:
        "Use time values exactly as given. Do not convert or show UTC.",
    }),
    sources: [
      {
        kind: "database",
        label: "Sessions",
        detail: label,
      },
    ],
    actions: [
      openPageAction("calendar", "Open Calendar", {
        filters: { yearLevel },
      }),
    ],
  };
}

/**
 * Recent change-history entries (metadata only — no before/after payloads).
 */
export async function searchChangeHistory(
  actor: AdminAiActor,
  args: {
    recordType?: string;
    actorName?: string;
    action?: string;
    days?: number;
  },
): Promise<ToolResult> {
  assertAdminAiModule(actor, "change-history");

  const recordType = args.recordType?.trim() || null;
  const actorName = args.actorName?.trim() || null;
  const action = args.action?.trim().toUpperCase() || null;
  const days = Math.min(90, Math.max(1, Math.floor(args.days ?? 7)));

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);

  const changes = await adminAiRepository.findChangeHistory({
    recordType,
    actorName,
    action,
    since,
  });
  const rows = changes.slice(0, LIST_MAX_ROWS).map((change) => ({
    when: change.createdAt.toISOString().slice(0, 16).replace("T", " "),
    actor: change.actorName,
    action: change.action,
    recordType: change.recordType,
    record: change.recordLabel,
    reference: change.reference,
  }));

  return {
    data: sanitizeToolPayload({
      entity: "change_history",
      matchLevel: rows.length ? "exact" : "none",
      days,
      changeCount: rows.length,
      truncated: changes.length > LIST_MAX_ROWS,
      changes: rows,
      columns: ["When", "Actor", "Action", "Type", "Record"],
      exactNote: rows.length
        ? null
        : `No change history in the last ${days} days.`,
      responseHint:
        "Entity is change history. Table: When | Actor | Action | Type | Record. Do not invent before/after field dumps.",
    }),
    sources: [
      {
        kind: "database",
        label: "Change history",
        detail: `Last ${days} days`,
      },
    ],
    actions: [openPageAction("change-history", "Open Change History")],
  };
}

export async function listHomework(
  actor: AdminAiActor,
  args: {
    startDate?: string;
    endDate?: string;
    subject?: string;
    title?: string;
    yearLevel?: string;
  },
): Promise<ToolResult> {
  assertAdminAiModule(actor, "classes");

  const { start, end } = clampRange(args.startDate, args.endDate);
  const startStr = start.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);
  const subject = args.subject?.trim() || null;
  const title = args.title?.trim() || null;
  const yearLevel = args.yearLevel?.trim() || null;

  const { items, totalMatched } = await adminAiRepository.findHomeworkList({
    startStr,
    endStr,
    subject,
    title,
    yearGroup: yearLevel,
    take: LIST_MAX_ROWS,
  });

  const rows = items.map((h) => ({
    title: h.title,
    dueDate: h.dueDate,
    subject: h.subject?.name ?? null,
    yearLevel: h.yearGroup || null,
  }));

  const filterLabel =
    [title, subject, yearLevel, `${startStr}–${endStr}`]
      .filter(Boolean)
      .join(", ") || "homework";

  return {
    data: sanitizeToolPayload({
      entity: "homework",
      matchLevel: rows.length ? "exact" : "none",
      dateRange: `${startStr}–${endStr}`,
      returnedCount: rows.length,
      totalMatched,
      truncated: totalMatched > rows.length,
      homework: rows,
      columns: ["Title", "Due", "Subject", "Year"],
      exactNote: rows.length
        ? null
        : `No homework found for ${filterLabel}.`,
      responseHint:
        "Entity is homework. Table: Title | Due | Subject | Year. Use totalMatched for counts. No descriptions, marks, fees, or student lists.",
    }),
    sources: [
      {
        kind: "database",
        label: "Homework",
        detail: filterLabel,
      },
    ],
    actions: [
      openPageAction("homework", "Open Homework", {
        filters: { yearLevel },
      }),
    ],
  };
}

export async function getPendingHomeworkSummary(
  actor: AdminAiActor,
  args: { startDate?: string; endDate?: string },
): Promise<ToolResult> {
  assertAdminAiModule(actor, "classes");
  const { start, end } = clampRange(args.startDate, args.endDate);
  const startStr = start.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);

  const { items: homework, totalMatched } =
    await adminAiRepository.findHomeworkList({
      startStr,
      endStr,
      take: LIST_MAX_ROWS,
    });

  const homeworkIds = homework.map((h) => h.id);
  if (homeworkIds.length === 0) {
    return {
      data: sanitizeToolPayload({
        startDate: startStr,
        endDate: endStr,
        homeworkCount: 0,
        totalMatched: 0,
        assignedStudents: 0,
        submittedCount: 0,
        pendingCount: 0,
      }),
      sources: [
        {
          kind: "database",
          label: "Homework",
          detail: `${startStr}–${endStr}`,
        },
      ],
      actions: [openPageAction("homework", "Open Homework")],
    };
  }

  const assigned = await adminAiRepository.countHomeworkStudents(homeworkIds);
  const submitted =
    await adminAiRepository.countHomeworkSubmissions(homeworkIds);

  return {
    data: sanitizeToolPayload({
      startDate: startStr,
      endDate: endStr,
      homeworkCount: homework.length,
      totalMatched,
      truncated: totalMatched > homework.length,
      assignedStudents: assigned,
      submittedCount: submitted,
      pendingCount: Math.max(0, assigned - submitted),
      note:
        "Submission counts cover the returned homework rows only when the list is truncated.",
      items: homework.slice(0, 15).map((h) => ({
        title: h.title,
        dueDate: h.dueDate,
        subject: h.subject?.name ?? null,
      })),
    }),
    sources: [
      {
        kind: "database",
        label: "Homework summary",
        detail: `${startStr}–${endStr}`,
      },
    ],
    actions: [openPageAction("homework", "Open Homework")],
  };
}

export async function getAcademicPerformanceSummary(
  actor: AdminAiActor,
  args: { subjectHint?: string },
): Promise<ToolResult> {
  assertAdminAiModule(actor, "classes");

  const rows = await adminAiRepository.getAcademicPerformanceAggregates(
    args.subjectHint,
  );

  return {
    data: sanitizeToolPayload({
      subjectHint: args.subjectHint?.trim() || null,
      assessments: rows.map((row) => ({
        title: row.assessmentTitle,
        markedCount: Number(row.markedCount) || 0,
        averageMark: row.averageMark
          ? Number(Number(row.averageMark).toFixed(2))
          : null,
      })),
    }),
    sources: [
      {
        kind: "database",
        label: "Academic report",
        detail: args.subjectHint?.trim()
          ? `Assessments · ${args.subjectHint.trim()}`
          : "Recent marked assessments",
      },
    ],
  };
}

export async function getEnquiryPipelineSummary(
  actor: AdminAiActor,
): Promise<ToolResult> {
  assertAdminAiModule(actor, "enquiries");

  const rows = await adminAiRepository.getEnquiryPipelineAggregates();

  return {
    data: sanitizeToolPayload({
      stages: rows.map((row) => ({
        stage: row.stageName,
        code: row.stageCode,
        kind: row.stageKind,
        count: Number(row.count) || 0,
      })),
      openCount: rows
        .filter((row) => row.stageKind === "OPEN")
        .reduce((sum, row) => sum + (Number(row.count) || 0), 0),
    }),
    sources: [
      {
        kind: "database",
        label: "Enquiry pipeline",
        detail: "Aggregate by stage",
      },
    ],
    actions: [openPageAction("enquiries", "Open Enquiries")],
  };
}

export async function getPendingEnrollmentSummary(
  actor: AdminAiActor,
): Promise<ToolResult> {
  assertAdminAiModule(actor, "enrolments");

  const pending = await adminAiRepository.countPendingEnrollments();

  return {
    data: sanitizeToolPayload({
      pendingCount: pending,
      note:
        "Counts pending enrolment invitations / incomplete enrolments only. No fee-arrears ledger is available.",
    }),
    sources: [
      {
        kind: "database",
        label: "Pending enrolments",
        detail: "Status = PENDING",
      },
    ],
    actions: [openPageAction("enrolments", "Open Enrolments")],
  };
}

export async function getOpenTasksSummary(
  actor: AdminAiActor,
): Promise<ToolResult> {
  assertAdminAiModule(actor, "tasks");
  const [openCount, overdueCount] = await Promise.all([
    adminAiRepository.countOpenTasks(),
    adminAiRepository.countOverdueOpenTasks(),
  ]);

  return {
    data: sanitizeToolPayload({
      openTaskCount: openCount,
      overdueOpenTaskCount: overdueCount,
      responseHint:
        "Short counts only. Prefer overdueOpenTaskCount when the user asks about overdue tasks.",
    }),
    sources: [
      {
        kind: "database",
        label: "Admin tasks",
        detail: "OPEN + overdue",
      },
    ],
    actions: [openPageAction("tasks", "Open Tasks")],
  };
}

/**
 * Compact read-only ops KPIs for dashboard-style questions.
 * Aggregates only — no PII, fees, or credentials.
 */
export async function getOpsSnapshot(
  actor: AdminAiActor,
): Promise<ToolResult> {
  assertAdminAiModule(actor, "classes");

  const week = clampRange(undefined, undefined);
  const day = dayBoundsInClassTz();

  const [
    openTasks,
    overdueTasks,
    pendingEnrolments,
    activeEnrolments,
    activeStudents,
    activeStaff,
    classCount,
    enquiryStages,
    attendanceRows,
    absences,
  ] = await Promise.all([
    adminAiRepository.countOpenTasks(),
    adminAiRepository.countOverdueOpenTasks(),
    adminAiRepository.countPendingEnrollments(),
    adminAiRepository.countActiveEnrollments(),
    adminAiRepository.countActiveUsersByRole(UserRole.STUDENT),
    adminAiRepository.countActiveUsersByRole(UserRole.STAFF),
    adminAiRepository.countClasses(),
    adminAiRepository.getEnquiryPipelineAggregates(),
    adminAiRepository.getAttendanceStatusCounts(week.start, week.endExclusive),
    adminAiRepository.findTodaysAbsences(day.start, day.end, null),
  ]);

  const attendanceByStatus: Record<string, number> = {};
  let attendanceTotal = 0;
  for (const row of attendanceRows) {
    const count = Number(row.count) || 0;
    attendanceByStatus[row.status] = count;
    attendanceTotal += count;
  }
  const presentOrLate =
    (attendanceByStatus.PRESENT ?? 0) + (attendanceByStatus.LATE ?? 0);
  const attendanceRate =
    attendanceTotal > 0
      ? Number(((presentOrLate / attendanceTotal) * 100).toFixed(1))
      : null;

  const openEnquiries = enquiryStages
    .filter((row) => row.stageKind === "OPEN")
    .reduce((sum, row) => sum + (Number(row.count) || 0), 0);

  return {
    data: sanitizeToolPayload({
      entity: "ops_snapshot",
      asOfDate: day.label,
      people: {
        activeStudents,
        activeStaffTeachers: activeStaff,
      },
      classes: {
        classCount,
      },
      enrolments: {
        activeEnrolments,
        pendingEnrolments,
      },
      enquiries: {
        openEnquiries,
      },
      tasks: {
        openTasks,
        overdueOpenTasks: overdueTasks,
      },
      attendanceLast7Days: {
        totalRecords: attendanceTotal,
        byStatus: attendanceByStatus,
        presentOrLateRatePercent: attendanceRate,
      },
      absencesToday: {
        count: absences.length,
        date: day.label,
        truncated: absences.length >= 60,
      },
      unavailable: [
        "Fee / payment ledgers are not available via Admin AI.",
        "WWCC / compliance credentials are not available via Admin AI.",
      ],
      responseHint:
        "Short KPI summary for dashboard-style questions. Use exact numbers. Do not invent fees or credentials. Mention absencesToday only if relevant.",
    }),
    sources: [
      {
        kind: "database",
        label: "Ops snapshot",
        detail: "Aggregates only",
      },
    ],
    actions: [
      openPageAction("dashboard", "Open Dashboard"),
      openPageAction("tasks", "Open Tasks"),
      openPageAction("attendance", "Open Attendance"),
    ],
  };
}
