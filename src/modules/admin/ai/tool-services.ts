import { Between, In } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import {
  AttendanceRecord,
  AttendanceStatus,
} from "../../../entities/AttendanceRecord.js";
import { Holiday } from "../../../entities/Holiday.js";
import { Term } from "../../../entities/Term.js";
import { Class } from "../../../entities/Class.js";
import { Enquiry } from "../../../entities/Enquiry.js";
import { Homework } from "../../../entities/Homework.js";
import { HomeworkStudent } from "../../../entities/HomeworkStudent.js";
import { HomeworkSubmission } from "../../../entities/HomeworkSubmission.js";
import { PendingEnrollment } from "../../../entities/PendingEnrollment.js";
import { PendingEnrollmentStatus } from "../../../common/constants/enrollment.js";
import { Session } from "../../../entities/Session.js";
import { Task, TaskStatus } from "../../../entities/Task.js";
import { Assessment } from "../../../entities/Assessment.js";
import { AssessmentSubmission } from "../../../entities/AssessmentSubmission.js";
import type { AdminAiSource } from "../../../entities/AdminAiMessage.js";
import { startTimeFromDayTime } from "../../../common/utils/schedule-slot.js";
import {
  calendarDateInTimeZone,
  dayRangeInTimeZone,
  DEFAULT_CLASS_TIMEZONE,
  formatInTimeZone,
  parseWallClockFromDayTime,
  resolveIanaTimeZone,
  zonedWallTimeToUtc,
} from "../../../common/utils/timezone.js";
import {
  assertAdminAiModule,
  type AdminAiActor,
} from "./authorization.js";
import { sanitizeToolPayload } from "./sanitize.js";

const MAX_RANGE_DAYS = 62;
const MAX_ROWS = 40;

function parseDateOnly(value: string | undefined, fallback: Date): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function sanitizeDateArg(value?: string): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const diffDays = Math.abs(Date.now() - parsed.getTime()) / 86_400_000;
  // Ignore nonsense model dates far from today (e.g. 2023-10-10).
  if (diffDays > 400) return undefined;
  return value;
}

function clampRange(startDate?: string, endDate?: string) {
  const safeEnd = sanitizeDateArg(endDate);
  const safeStart = sanitizeDateArg(startDate);
  let end = parseDateOnly(safeEnd, new Date());
  const startDefault = new Date(end);
  startDefault.setUTCDate(startDefault.getUTCDate() - 7);
  let start = parseDateOnly(safeStart, startDefault);
  if (start > end) {
    const tmp = start;
    start = end;
    end = tmp;
  }
  const maxStart = new Date(end);
  maxStart.setUTCDate(maxStart.getUTCDate() - MAX_RANGE_DAYS);
  if (start < maxStart) start = maxStart;
  const endExclusive = new Date(end);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return { start, end, endExclusive };
}

function dayBoundsInClassTz(date?: string, timeZone?: string | null) {
  const tz = resolveIanaTimeZone(timeZone ?? DEFAULT_CLASS_TIMEZONE);
  let ref = new Date();
  const safeDate = sanitizeDateArg(date);
  if (safeDate) {
    const [year, month, day] = safeDate.split("-").map(Number);
    ref = zonedWallTimeToUtc(
      { year, month, day, hour: 12, minute: 0, second: 0 },
      tz,
    );
  }
  const { start, end } = dayRangeInTimeZone(ref, tz);
  return {
    start,
    end,
    label: calendarDateInTimeZone(ref, tz),
    timeZone: tz,
  };
}

function formatLocalTime12h(value: Date, timeZone?: string | null): string {
  return formatInTimeZone(value, timeZone, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).toLowerCase();
}

function formatWallClock12h(hour: number, minute: number): string {
  const ampm = hour >= 12 ? "pm" : "am";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${ampm}`;
}

function weekdayFromDayTime(dayTime: string | null): string | null {
  const parsed = parseWallClockFromDayTime(dayTime);
  if (!parsed) return null;
  const dayName = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ][
    new Date(
      Date.UTC(parsed.start.year, parsed.start.month - 1, parsed.start.day, 12),
    ).getUTCDay()
  ];
  if (
    dayName !== "Monday" &&
    dayName !== "Tuesday" &&
    dayName !== "Wednesday" &&
    dayName !== "Thursday" &&
    dayName !== "Friday"
  ) {
    return null;
  }
  return dayName;
}

function durationFromDayTime(dayTime: string | null): string {
  const parsed = parseWallClockFromDayTime(dayTime);
  if (!parsed?.end) return "1 hr";
  const startMinutes = parsed.start.hour * 60 + parsed.start.minute;
  let endMinutes = parsed.end.hour * 60 + parsed.end.minute;
  if (endMinutes <= startMinutes) endMinutes += 24 * 60;
  const mins = endMinutes - startMinutes;
  if (mins >= 60 && mins % 60 === 0) return `${mins / 60} hr`;
  return `${mins} min`;
}

function formatLocalSessionTime(
  startAt: Date,
  endAt: Date,
  timeZone?: string | null,
) {
  const tz = resolveIanaTimeZone(timeZone);
  const durationMinutes = Math.max(
    0,
    Math.round((endAt.getTime() - startAt.getTime()) / 60_000),
  );
  const durationLabel =
    durationMinutes >= 60 && durationMinutes % 60 === 0
      ? `${durationMinutes / 60} hr`
      : `${durationMinutes} min`;
  return {
    time: `${formatLocalTime12h(startAt, tz)} – ${formatLocalTime12h(endAt, tz)}`,
    startTime: formatLocalTime12h(startAt, tz),
    endTime: formatLocalTime12h(endAt, tz),
    duration: durationLabel,
    durationMinutes,
    timeZone: tz,
  };
}

export type ToolResult = {
  data: unknown;
  sources: AdminAiSource[];
  documentIds?: string[];
};

export async function getAttendanceSummary(
  actor: AdminAiActor,
  args: { startDate?: string; endDate?: string },
): Promise<ToolResult> {
  assertAdminAiModule(actor, "attendance");
  const { start, end, endExclusive } = clampRange(args.startDate, args.endDate);

  const rows = await AppDataSource.getRepository(AttendanceRecord)
    .createQueryBuilder("ar")
    .innerJoin("ar.session", "session")
    .select("ar.status", "status")
    .addSelect("COUNT(*)", "count")
    .where("session.startAt >= :start AND session.startAt < :end", {
      start,
      end: endExclusive,
    })
    .groupBy("ar.status")
    .getRawMany<{ status: string; count: string }>();

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

  const rows = await AppDataSource.query(
    `
    SELECT
      c.id AS "classId",
      c.name AS "className",
      c.subject AS subject,
      COUNT(ar.id)::int AS "totalRecords",
      COUNT(*) FILTER (
        WHERE ar.status IN ('PRESENT', 'LATE')
      )::int AS "presentOrLate"
    FROM attendance_records ar
    INNER JOIN sessions s ON s.id = ar."sessionId"
    INNER JOIN classes c ON c.id = s."classId"
    WHERE s."startAt" >= $1 AND s."startAt" < $2
      AND s."classId" IS NOT NULL
    GROUP BY c.id, c.name, c.subject
    HAVING COUNT(ar.id) > 0
    ORDER BY
      (COUNT(*) FILTER (WHERE ar.status IN ('PRESENT', 'LATE'))::float
        / NULLIF(COUNT(ar.id), 0)) ASC
    LIMIT $3
    `,
    [start, endExclusive, MAX_ROWS],
  );

  const classes = (rows as Array<Record<string, unknown>>)
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
      thresholdPercent: threshold,
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      classes,
    }),
    sources: [
      {
        kind: "database",
        label: "Class attendance",
        detail: `Below ${threshold}% · ${start.toISOString().slice(0, 10)}–${end.toISOString().slice(0, 10)}`,
      },
    ],
  };
}

export async function getTodayTimetable(
  actor: AdminAiActor,
  args: { date?: string; yearLevel?: string },
): Promise<ToolResult> {
  assertAdminAiModule(actor, "classes");
  const { start, end, label } = dayBoundsInClassTz(args.date);
  const yearLevel = args.yearLevel?.trim() || null;

  const qb = AppDataSource.getRepository(Session)
    .createQueryBuilder("session")
    .leftJoinAndSelect("session.class", "class")
    .leftJoinAndSelect("class.term", "term")
    .leftJoinAndSelect("term.yearLevel", "yearLevel")
    .leftJoinAndSelect("term.academicYear", "academicYear")
    .leftJoinAndSelect("session.teacher", "sessionTeacher")
    .leftJoinAndSelect("class.teacher", "classTeacher")
    .leftJoinAndSelect("session.classroom", "classroom")
    .where("session.startAt >= :start AND session.startAt < :end", {
      start,
      end,
    })
    .andWhere("session.classId IS NOT NULL")
    .orderBy("session.startAt", "ASC")
    .take(MAX_ROWS);

  if (yearLevel) {
    qb.andWhere(
      `(yearLevel.name ILIKE :yl OR CAST(yearLevel.sequence AS text) = :ylExact OR class.name ILIKE :yl)`,
      {
        yl: `%${yearLevel}%`,
        ylExact: yearLevel.replace(/[^0-9]/g, "") || yearLevel,
      },
    );
  }

  const sessions = await qb.getMany();
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

  const qb = AppDataSource.getRepository(Class)
    .createQueryBuilder("class")
    .leftJoinAndSelect("class.term", "term")
    .leftJoinAndSelect("term.yearLevel", "yearLevel")
    .leftJoinAndSelect("term.academicYear", "academicYear")
    .leftJoinAndSelect("class.teacher", "teacher")
    .leftJoinAndSelect("class.classroom", "classroom")
    .where("class.dayTime IS NOT NULL")
    .orderBy("class.subject", "ASC")
    .take(200);

  if (term) {
    qb.andWhere(
      `(term.name ILIKE :term OR class.termName ILIKE :term)`,
      { term: `%${term}%` },
    );
  }

  if (yearLevel) {
    qb.andWhere(
      `(yearLevel.name ILIKE :yl OR CAST(yearLevel.sequence AS text) = :ylExact OR class.name ILIKE :yl)`,
      {
        yl: `%${yearLevel}%`,
        ylExact: yearLevel.replace(/[^0-9]/g, "") || yearLevel,
      },
    );
  }

  if (academicYear) {
    qb.andWhere(
      `(CAST(academicYear.year AS text) ILIKE :ay OR academicYear.displayName ILIKE :ay)`,
      { ay: `%${academicYear}%` },
    );
  }

  const classes = await qb.getMany();
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

  const homework = await AppDataSource.getRepository(Homework).find({
    where: {
      dueDate: Between(startStr, endStr),
    },
    relations: { subject: true },
    take: MAX_ROWS,
    order: { dueDate: "ASC" },
  });

  const homeworkIds = homework.map((h) => h.id);
  if (homeworkIds.length === 0) {
    return {
      data: {
        startDate: startStr,
        endDate: endStr,
        homeworkCount: 0,
        assignedStudents: 0,
        submittedCount: 0,
        pendingCount: 0,
      },
      sources: [
        {
          kind: "database",
          label: "Homework",
          detail: `${startStr}–${endStr}`,
        },
      ],
    };
  }

  const assigned = await AppDataSource.getRepository(HomeworkStudent).count({
    where: { homeworkId: In(homeworkIds) },
  });
  const submitted = await AppDataSource.getRepository(HomeworkSubmission).count({
    where: { homeworkId: In(homeworkIds), status: "SUBMITTED" },
  });

  return {
    data: sanitizeToolPayload({
      startDate: startStr,
      endDate: endStr,
      homeworkCount: homework.length,
      assignedStudents: assigned,
      submittedCount: submitted,
      pendingCount: Math.max(0, assigned - submitted),
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
  };
}

export async function getAcademicPerformanceSummary(
  actor: AdminAiActor,
  args: { subjectHint?: string },
): Promise<ToolResult> {
  assertAdminAiModule(actor, "classes");

  const qb = AppDataSource.getRepository(AssessmentSubmission)
    .createQueryBuilder("sub")
    .innerJoin(Assessment, "assessment", "assessment.id = sub.assessmentId")
    .select("assessment.title", "assessmentTitle")
    .addSelect("COUNT(sub.id)", "markedCount")
    .addSelect("AVG(sub.mark::float)", "averageMark")
    .where("sub.mark IS NOT NULL")
    .groupBy("assessment.id")
    .addGroupBy("assessment.title")
    .orderBy("AVG(sub.mark::float)", "ASC")
    .limit(20);

  if (args.subjectHint?.trim()) {
    qb.andWhere(
      `(assessment.title ILIKE :hint OR assessment.subject ILIKE :hint)`,
      { hint: `%${args.subjectHint.trim()}%` },
    );
  }

  const rows = await qb.getRawMany<{
    assessmentTitle: string;
    markedCount: string;
    averageMark: string;
  }>();

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

  const rows = await AppDataSource.getRepository(Enquiry)
    .createQueryBuilder("enquiry")
    .innerJoin("enquiry.currentStage", "stage")
    .select("stage.name", "stageName")
    .addSelect("stage.code", "stageCode")
    .addSelect("stage.kind", "stageKind")
    .addSelect("COUNT(enquiry.id)", "count")
    .groupBy("stage.id")
    .addGroupBy("stage.name")
    .addGroupBy("stage.code")
    .addGroupBy("stage.kind")
    .orderBy("stage.sortOrder", "ASC")
    .getRawMany<{
      stageName: string;
      stageCode: string;
      stageKind: string;
      count: string;
    }>();

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
  };
}

export async function getPendingEnrollmentSummary(
  actor: AdminAiActor,
): Promise<ToolResult> {
  assertAdminAiModule(actor, "enrolments");

  const pending = await AppDataSource.getRepository(PendingEnrollment).count({
    where: { status: PendingEnrollmentStatus.PENDING },
  });

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
  };
}

export async function getOpenTasksSummary(
  actor: AdminAiActor,
): Promise<ToolResult> {
  assertAdminAiModule(actor, "tasks");
  const openCount = await AppDataSource.getRepository(Task).count({
    where: { status: TaskStatus.OPEN },
  });

  return {
    data: sanitizeToolPayload({ openTaskCount: openCount }),
    sources: [
      {
        kind: "database",
        label: "Admin tasks",
        detail: "OPEN tasks",
      },
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

  const params: unknown[] = [start, end];
  let yearFilter = "";
  if (yearLevel) {
    params.push(`%${yearLevel}%`);
    params.push(yearLevel.replace(/[^0-9]/g, "") || yearLevel);
    yearFilter = `
      AND (
        yl.name ILIKE $3
        OR CAST(yl.sequence AS text) = $4
        OR c.name ILIKE $3
      )
    `;
  }

  const rows = (await AppDataSource.query(
    `
    SELECT
      COALESCE(u."fullName", 'Unknown') AS "studentName",
      ar.status AS status,
      c.name AS "className",
      c.subject AS subject,
      yl.name AS "yearLevel",
      s."startAt" AS "startAt",
      c."timeZone" AS "timeZone"
    FROM attendance_records ar
    INNER JOIN sessions s ON s.id = ar."sessionId"
    LEFT JOIN users u ON u.id = ar."studentId"
    LEFT JOIN classes c ON c.id = s."classId"
    LEFT JOIN terms t ON t.id = c."termId"
    LEFT JOIN year_levels yl ON yl.id = t."yearLevelId"
    WHERE s."startAt" >= $1
      AND s."startAt" < $2
      AND ar.status IN ('ABSENT', 'EXCUSED', 'PENDING')
      ${yearFilter}
    ORDER BY s."startAt" ASC, u."fullName" ASC
    LIMIT 60
    `,
    params,
  )) as Array<{
    studentName: string;
    status: string;
    className: string | null;
    subject: string | null;
    yearLevel: string | null;
    startAt: Date;
    timeZone: string | null;
  }>;

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
  };
}

export async function getClassRoster(
  actor: AdminAiActor,
  args: { yearLevel?: string; subjectOrClass?: string },
): Promise<ToolResult> {
  assertAdminAiModule(actor, "classes");

  const yearLevel = args.yearLevel?.trim() || null;
  const subjectOrClass = args.subjectOrClass?.trim() || null;

  const params: unknown[] = [];
  const where: string[] = [];

  if (yearLevel) {
    params.push(`%${yearLevel}%`);
    const ylLike = params.length;
    params.push(yearLevel.replace(/[^0-9]/g, "") || yearLevel);
    const ylExact = params.length;
    where.push(
      `(yl.name ILIKE $${ylLike} OR CAST(yl.sequence AS text) = $${ylExact} OR c.name ILIKE $${ylLike})`,
    );
  }

  if (subjectOrClass) {
    params.push(`%${subjectOrClass}%`);
    const subjectIdx = params.length;
    where.push(
      `(c.subject ILIKE $${subjectIdx} OR c.name ILIKE $${subjectIdx} OR c.lesson ILIKE $${subjectIdx})`,
    );
  }

  if (where.length === 0) {
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

  const rows = (await AppDataSource.query(
    `
    SELECT DISTINCT
      c.name AS "className",
      c.subject AS subject,
      yl.name AS "yearLevel",
      COALESCE(u."fullName", 'Unknown') AS "studentName"
    FROM class_students cs
    INNER JOIN classes c ON c.id = cs."classId"
    INNER JOIN users u ON u.id = cs."studentId"
    LEFT JOIN terms t ON t.id = c."termId"
    LEFT JOIN year_levels yl ON yl.id = t."yearLevelId"
    WHERE ${where.join(" AND ")}
    ORDER BY c.name ASC, u."fullName" ASC
    LIMIT 80
    `,
    params,
  )) as Array<{
    className: string;
    subject: string | null;
    yearLevel: string | null;
    studentName: string;
  }>;

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
  };
}

function formatHolidayDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function datesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string,
): boolean {
  return startA <= endB && endA >= startB;
}

export async function getHolidays(
  actor: AdminAiActor,
  args: { term?: string; yearLevel?: string; academicYear?: string },
): Promise<ToolResult> {
  assertAdminAiModule(actor, "settings");

  const termFilter = args.term?.trim() || null;
  const yearLevel = args.yearLevel?.trim() || null;
  const academicYear = args.academicYear?.trim() || null;

  const termsQb = AppDataSource.getRepository(Term)
    .createQueryBuilder("term")
    .leftJoinAndSelect("term.yearLevel", "yearLevel")
    .leftJoinAndSelect("term.academicYear", "academicYear");

  if (termFilter) {
    termsQb.andWhere("term.name ILIKE :term", { term: `%${termFilter}%` });
  }
  if (yearLevel) {
    termsQb.andWhere(
      `(yearLevel.name ILIKE :yl OR CAST(yearLevel.sequence AS text) = :ylExact)`,
      {
        yl: `%${yearLevel}%`,
        ylExact: yearLevel.replace(/[^0-9]/g, "") || yearLevel,
      },
    );
  }
  if (academicYear) {
    termsQb.andWhere(
      `(CAST(academicYear.year AS text) ILIKE :ay OR academicYear.displayName ILIKE :ay)`,
      { ay: `%${academicYear}%` },
    );
  }

  const matchedTerms =
    termFilter || yearLevel || academicYear
      ? await termsQb.getMany()
      : [];

  const holidays = await AppDataSource.getRepository(Holiday).find({
    relations: {
      term: { academicYear: true, yearLevel: true },
    },
    order: { startDate: "ASC", name: "ASC" },
    take: 100,
  });

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
  };
}

export async function getDraftContext(
  actor: AdminAiActor,
  args: { topic?: string },
): Promise<ToolResult> {
  // Draft context is available to any Admin AI caller; no write side effects.
  void actor;
  return {
    data: sanitizeToolPayload({
      topic: args.topic?.trim() || "general notice",
      guidance:
        "Produce a clearly labeled Draft only. Do not send, publish, or claim delivery.",
      institutionTone: "Professional, clear, supportive tutoring-centre voice.",
    }),
    sources: [
      {
        kind: "draft",
        label: "Draft context",
        detail: args.topic?.trim() || "general",
      },
    ],
  };
}
