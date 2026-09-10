import {
  AttendanceStatus,
} from "../../../../entities/AttendanceRecord.js";
import { startTimeFromDayTime } from "../../../../common/utils/schedule-slot.js";
import {
  DEFAULT_CLASS_TIMEZONE,
  parseWallClockFromDayTime,
} from "../../../../common/utils/timezone.js";
import {
  assertAdminAiModule,
  type AdminAiActor,
} from "../authorization.js";
import { sanitizeToolPayload } from "../sanitize.js";
import { adminAiRepository } from "../admin-ai.repository.js";
import {
  MAX_ROWS,
  clampRange,
  dayBoundsInClassTz,
  datesOverlap,
  durationFromDayTime,
  formatHolidayDate,
  formatLocalSessionTime,
  formatLocalTime12h,
  formatWallClock12h,
  openPageAction,
  weekdayFromDayTime,
  type ToolResult,
} from "../tool-helpers.js";

export async function getAttendanceSummary(
  actor: AdminAiActor,
  args: { startDate?: string; endDate?: string },
): Promise<ToolResult> {
  assertAdminAiModule(actor, "attendance");
  const { start, end, endExclusive } = clampRange(args.startDate, args.endDate);

  const rows = await adminAiRepository.getAttendanceStatusCounts(
    start,
    endExclusive,
  );

  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    const count = Number(row.count) || 0;
    byStatus[row.status] = count;
    total += count;
  }

  const present =
    (byStatus[AttendanceStatus.PRESENT] ?? 0) +
    (byStatus[AttendanceStatus.LATE] ?? 0);
  const rate = total > 0 ? Number(((present / total) * 100).toFixed(1)) : null;

  return {
    data: sanitizeToolPayload({
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      totalRecords: total,
      byStatus,
      presentOrLateRatePercent: rate,
    }),
    sources: [
      {
        kind: "database",
        label: "Attendance data",
        detail: `${start.toISOString().slice(0, 10)}–${end.toISOString().slice(0, 10)}`,
      },
    ],
    actions: [openPageAction("attendance", "View Attendance")],
  };
}

export async function getLowAttendanceClasses(
  actor: AdminAiActor,
  args: { threshold?: number; startDate?: string; endDate?: string },
): Promise<ToolResult> {
  assertAdminAiModule(actor, "attendance");
  assertAdminAiModule(actor, "classes");
  const threshold = Math.min(100, Math.max(1, Number(args.threshold) || 80));
  const { start, end, endExclusive } = clampRange(args.startDate, args.endDate);

  const rows = await adminAiRepository.getLowAttendanceClassAggregates(
    start,
    endExclusive,
    MAX_ROWS,
  );

  const classes = rows
    .map((row) => {
      const total = Number(row.totalRecords) || 0;
      const present = Number(row.presentOrLate) || 0;
      const rate = total > 0 ? (present / total) * 100 : 0;
      return {
        className: String(row.className ?? ""),
        subject: row.subject ? String(row.subject) : null,
        totalRecords: total,
        presentOrLate: present,
        attendanceRatePercent: Number(rate.toFixed(1)),
      };
    })
    .filter((row) => row.attendanceRatePercent < threshold);

  return {
    data: sanitizeToolPayload({
      entity: "low_attendance_class",
      thresholdPercent: threshold,
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      classes,
      columns: ["Class", "Subject", "Attendance Rate"],
      responseHint:
        "Entity is classes with low attendance. Table: Class | Subject | Attendance Rate. Do NOT list students from this tool.",
    }),
    sources: [
      {
        kind: "database",
        label: "Class attendance",
        detail: `Below ${threshold}% · ${start.toISOString().slice(0, 10)}–${end.toISOString().slice(0, 10)}`,
      },
    ],
    actions: [openPageAction("attendance", "View Attendance")],
  };
}

/**
 * Students whose present/late rate is below threshold in the date range.
 * Use for "students with low attendance" — not class aggregates.
 */
export async function getLowAttendanceStudents(
  actor: AdminAiActor,
  args: {
    threshold?: number;
    startDate?: string;
    endDate?: string;
    subject?: string;
  },
): Promise<ToolResult> {
  assertAdminAiModule(actor, "attendance");
  const threshold = Math.min(100, Math.max(1, Number(args.threshold) || 80));
  const subject = args.subject?.trim() || null;
  const { start, end, endExclusive } = clampRange(args.startDate, args.endDate);

  const rows = await adminAiRepository.getLowAttendanceStudentAggregates(
    start,
    endExclusive,
    { thresholdPercent: threshold, subject, limit: MAX_ROWS },
  );

  const students = rows.map((row) => {
    const total = Number(row.totalRecords) || 0;
    const present = Number(row.presentOrLate) || 0;
    const rate = total > 0 ? (present / total) * 100 : 0;
    return {
      studentName: String(row.studentName ?? "Unknown"),
      subject: row.primarySubject ? String(row.primarySubject) : null,
      className: row.primaryClassName ? String(row.primaryClassName) : null,
      sessionsMarked: total,
      presentOrLate: present,
      attendanceRatePercent: Number(rate.toFixed(1)),
    };
  });

  const actions = [openPageAction("attendance", "View Attendance")];
  if (rows.length === 1) {
    actions.unshift(
      openPageAction("person", "View Student", { id: rows[0]!.studentId }),
    );
  }

  return {
    data: sanitizeToolPayload({
      entity: "low_attendance_student",
      thresholdPercent: threshold,
      subjectFilter: subject,
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      studentCount: students.length,
      students,
      columns: ["Student", "Subject", "Class", "Attendance Rate", "Present/Sessions"],
      exactNote: students.length
        ? null
        : `No students below ${threshold}% attendance for the selected period.`,
      responseHint:
        "Entity is students with low attendance. Table: Student | Subject | Class | Attendance Rate | Present/Sessions. Never use class-only tools for this question. No emails, phones, or IDs.",
    }),
    sources: [
      {
        kind: "database",
        label: "Student attendance",
        detail: `Below ${threshold}% · ${start.toISOString().slice(0, 10)}–${end.toISOString().slice(0, 10)}`,
      },
    ],
    actions,
  };
}

export async function getTodayTimetable(
  actor: AdminAiActor,
  args: { date?: string; yearLevel?: string },
): Promise<ToolResult> {
  assertAdminAiModule(actor, "classes");
  const { start, end, label } = dayBoundsInClassTz(args.date);
  const yearLevel = args.yearLevel?.trim() || null;

  const sessions = await adminAiRepository.findSessionsForDay(
    start,
    end,
    yearLevel,
  );
  const items = sessions.map((session) => {
    const teacher =
      session.teacher?.fullName ?? session.class?.teacher?.fullName ?? null;
    const local = formatLocalSessionTime(
      session.startAt,
      session.endAt,
      session.class?.timeZone,
    );
    return {
      className: session.class?.name ?? null,
      subject: session.class?.subject ?? null,
      room: session.classroom?.name ?? session.room ?? session.class?.room ?? null,
      term: session.class?.term?.name ?? session.class?.termName ?? null,
      academicYear: session.class?.term?.academicYear
        ? String(session.class.term.academicYear.year)
        : null,
      yearLevel: session.class?.term?.yearLevel?.name ?? null,
      teacherAssigned: teacher,
      // Local wall-clock times only — never raw UTC ISO for display.
      time: local.time,
      startTime: local.startTime,
      endTime: local.endTime,
      duration: local.duration,
      timeZone: local.timeZone,
    };
  });

  return {
    data: sanitizeToolPayload({
      date: label,
      yearLevelFilter: yearLevel,
      sessionCount: items.length,
      sessions: items,
      displayNote:
        "Use startTime/endTime/duration exactly as given. Do not convert or show UTC.",
    }),
    sources: [
      {
        kind: "database",
        label: "Class timetable",
        detail: yearLevel ? `${label} · ${yearLevel}` : label,
      },
    ],
    actions: [
      openPageAction("calendar", "Open Calendar", {
        filters: {
          yearLevel,
          year: items[0]?.academicYear ?? undefined,
        },
      }),
    ],
  };
}

export async function getTermClassSchedule(
  actor: AdminAiActor,
  args: { term?: string; yearLevel?: string; academicYear?: string },
): Promise<ToolResult> {
  assertAdminAiModule(actor, "classes");

  const term = args.term?.trim() || null;
  const yearLevel = args.yearLevel?.trim() || null;
  const academicYear = args.academicYear?.trim() || null;

  const classes = await adminAiRepository.findClassesWithDayTime({
    term,
    yearLevel,
    academicYear,
  });
  const seen = new Set<string>();
  const slots: Array<Record<string, string | null>> = [];

  for (const cls of classes) {
    const weekday = weekdayFromDayTime(cls.dayTime);
    const parsed = parseWallClockFromDayTime(cls.dayTime);
    const hhmm = startTimeFromDayTime(cls.dayTime);
    if (!weekday || !parsed || !hhmm) continue;

    const teacher = cls.teacher?.fullName ?? "Unassigned";
    const subject = (cls.subject ?? cls.name ?? "").trim();
    const key = `${cls.term?.name ?? cls.termName ?? ""}|${weekday}|${hhmm}|${subject}|${teacher}`;
    if (seen.has(key)) continue;
    seen.add(key);

    slots.push({
      term: cls.term?.name ?? cls.termName ?? null,
      academicYear: cls.term?.academicYear
        ? String(cls.term.academicYear.year)
        : null,
      yearLevel: cls.term?.yearLevel?.name ?? null,
      weekday,
      subject: subject || null,
      className: cls.name,
      startTime: formatWallClock12h(parsed.start.hour, parsed.start.minute),
      duration: durationFromDayTime(cls.dayTime),
      teacherAssigned: teacher,
      room: cls.classroom?.name ?? cls.room ?? null,
    });
  }

  const weekdayOrder: Record<string, number> = {
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
  };
  slots.sort((a, b) => {
    const termCmp = String(a.term ?? "").localeCompare(String(b.term ?? ""));
    if (termCmp !== 0) return termCmp;
    const dayCmp =
      (weekdayOrder[String(a.weekday)] ?? 9) -
      (weekdayOrder[String(b.weekday)] ?? 9);
    if (dayCmp !== 0) return dayCmp;
    return String(a.startTime).localeCompare(String(b.startTime));
  });

  return {
    data: sanitizeToolPayload({
      termFilter: term,
      yearLevelFilter: yearLevel,
      academicYearFilter: academicYear,
      slotCount: slots.length,
      note:
        "Weekly class timetable for the term (not only today). Show these slots when the user asks about a term timetable.",
      slots: slots.slice(0, MAX_ROWS),
    }),
    sources: [
      {
        kind: "database",
        label: "Term class timetable",
        detail: [term, yearLevel, academicYear].filter(Boolean).join(" · ") || "All scheduled classes",
      },
    ],
    actions: [
      openPageAction("calendar", "Open Calendar", {
        filters: { yearLevel, year: academicYear },
      }),
      openPageAction("classes", "Open Classes", {
        filters: { yearLevel, year: academicYear, term },
      }),
    ],
  };
}

export async function getTodaysAbsences(
  actor: AdminAiActor,
  args: { date?: string; yearLevel?: string },
): Promise<ToolResult> {
  assertAdminAiModule(actor, "attendance");
  const { start, end, label } = dayBoundsInClassTz(args.date);
  const yearLevel = args.yearLevel?.trim() || null;

  const rows = await adminAiRepository.findTodaysAbsences(
    start,
    end,
    yearLevel,
  );

  const absences = rows.map((row) => ({
    studentName: row.studentName,
    status: row.status,
    className: row.className,
    subject: row.subject,
    yearLevel: row.yearLevel,
    sessionTime: formatLocalTime12h(
      new Date(row.startAt),
      row.timeZone ?? DEFAULT_CLASS_TIMEZONE,
    ),
  }));

  return {
    data: sanitizeToolPayload({
      date: label,
      yearLevelFilter: yearLevel,
      count: absences.length,
      absences,
    }),
    sources: [
      {
        kind: "database",
        label: "Attendance absences",
        detail: yearLevel ? `${label} · ${yearLevel}` : label,
      },
    ],
    actions: [
      openPageAction("attendance", "View Attendance", {
        filters: { yearLevel },
      }),
    ],
  };
}

export async function getClassRoster(
  actor: AdminAiActor,
  args: { yearLevel?: string; subjectOrClass?: string },
): Promise<ToolResult> {
  assertAdminAiModule(actor, "classes");

  const yearLevel = args.yearLevel?.trim() || null;
  const subjectOrClass = args.subjectOrClass?.trim() || null;

  if (!yearLevel && !subjectOrClass) {
    return {
      data: {
        note: "Provide a year level and/or subject/class name to list enrolled students.",
        students: [],
      },
      sources: [
        {
          kind: "database",
          label: "Class roster",
          detail: "Filter required",
        },
      ],
    };
  }

  const rows = await adminAiRepository.findClassRosterRows(
    yearLevel,
    subjectOrClass,
  );

  const byClass = new Map<
    string,
    {
      className: string;
      subject: string | null;
      yearLevel: string | null;
      students: string[];
    }
  >();

  for (const row of rows) {
    const key = `${row.className}|${row.subject ?? ""}`;
    const existing = byClass.get(key);
    if (existing) {
      if (!existing.students.includes(row.studentName)) {
        existing.students.push(row.studentName);
      }
    } else {
      byClass.set(key, {
        className: row.className,
        subject: row.subject,
        yearLevel: row.yearLevel,
        students: [row.studentName],
      });
    }
  }

  const classes = [...byClass.values()].map((item) => ({
    ...item,
    studentCount: item.students.length,
  }));

  return {
    data: sanitizeToolPayload({
      yearLevelFilter: yearLevel,
      subjectOrClassFilter: subjectOrClass,
      classCount: classes.length,
      classes,
    }),
    sources: [
      {
        kind: "database",
        label: "Class enrolment roster",
        detail: [yearLevel, subjectOrClass].filter(Boolean).join(" · ") || "Filtered classes",
      },
    ],
    actions: [
      openPageAction("classes", "Open Classes", {
        filters: { yearLevel },
      }),
      openPageAction("enrolments", "Open Enrolments", {
        filters: { yearLevel },
      }),
    ],
  };
}

export async function getHolidays(
  actor: AdminAiActor,
  args: { term?: string; yearLevel?: string; academicYear?: string },
): Promise<ToolResult> {
  assertAdminAiModule(actor, "settings");

  const termFilter = args.term?.trim() || null;
  const yearLevel = args.yearLevel?.trim() || null;
  const academicYear = args.academicYear?.trim() || null;

  const matchedTerms =
    termFilter || yearLevel || academicYear
      ? await adminAiRepository.findTermsMatching({
          term: termFilter,
          yearLevel,
          academicYear,
        })
      : [];

  const holidays = await adminAiRepository.findAllHolidays();

  const termIds = new Set(matchedTerms.map((term) => term.id));
  const termRanges = matchedTerms.map((term) => ({
    id: term.id,
    name: term.name,
    startDate: term.startDate,
    endDate: term.endDate,
    yearLevel: term.yearLevel?.name ?? null,
  }));

  const relevant = holidays.filter((holiday) => {
    if (!termFilter && !yearLevel && !academicYear) {
      return true;
    }
    if (holiday.kind === "TERM") {
      return holiday.termId ? termIds.has(holiday.termId) : false;
    }
    // Public holidays apply institution-wide; include those that fall inside matched terms.
    if (termRanges.length === 0) return holiday.kind === "PUBLIC";
    return termRanges.some((term) =>
      datesOverlap(
        holiday.startDate,
        holiday.endDate,
        term.startDate,
        term.endDate,
      ),
    );
  });

  const rows = relevant.slice(0, MAX_ROWS).map((holiday) => {
    const sameDay = holiday.startDate === holiday.endDate;
    return {
      name: holiday.name,
      type: holiday.kind === "PUBLIC" ? "Public holiday" : "Term holiday",
      startDate: formatHolidayDate(holiday.startDate),
      endDate: formatHolidayDate(holiday.endDate),
      dates: sameDay
        ? formatHolidayDate(holiday.startDate)
        : `${formatHolidayDate(holiday.startDate)} – ${formatHolidayDate(holiday.endDate)}`,
      term: holiday.term?.name ?? null,
      yearLevel: holiday.term?.yearLevel?.name ?? null,
    };
  });

  return {
    data: sanitizeToolPayload({
      termFilter,
      yearLevelFilter: yearLevel,
      academicYearFilter: academicYear,
      matchedTerms: termRanges.map((term) => ({
        name: term.name,
        yearLevel: term.yearLevel,
        startDate: formatHolidayDate(term.startDate),
        endDate: formatHolidayDate(term.endDate),
      })),
      holidayCount: rows.length,
      holidays: rows,
      note:
        "For holiday questions, list these holidays in a table with Name and Dates. Do not answer with the class timetable.",
    }),
    sources: [
      {
        kind: "database",
        label: "Holidays",
        detail:
          [termFilter, yearLevel, academicYear].filter(Boolean).join(" · ") ||
          "All holidays",
      },
    ],
    actions: [openPageAction("holidays", "Open Holidays")],
  };
}
