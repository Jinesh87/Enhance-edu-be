import { AppDataSource } from "../../../config/data-source.js";
import {
  EnrollmentStatus,
  PendingEnrollmentStatus,
} from "../../../common/constants/enrollment.js";
import { AttendanceRecord } from "../../../entities/AttendanceRecord.js";
import { Enrollment } from "../../../entities/Enrollment.js";
import { Enquiry } from "../../../entities/Enquiry.js";
import { PendingEnrollment } from "../../../entities/PendingEnrollment.js";
import { Session } from "../../../entities/Session.js";
import { Task, TaskStatus } from "../../../entities/Task.js";
import {
  clampRange,
  dayBoundsInClassTz,
} from "../ai/tool-helpers.js";
import { adminPayrollService } from "../payroll/admin-payroll.service.js";

export type DashboardNeed = {
  id: string;
  title: string;
  tone: "danger" | "warn" | "ok";
  actionLabel: string;
  href: string;
};

export type DashboardMetric = {
  id: string;
  label: string;
  value: number;
  hint: string;
  tone: "up" | "neutral" | "danger";
  info: string;
  href: string;
  /** How to render value; defaults to plain number. */
  format?: "number" | "currency" | "hours";
  currency?: string;
};

export type DashboardFunnelStage = {
  stageName: string;
  stageCode: string;
  count: number;
  widthPercent: number;
  conversionLabel: string;
};

export type DashboardAttendanceDay = {
  date: string;
  label: string;
  presentOrLate: number;
  total: number;
  ratePercent: number;
};

export type AdminDashboardSnapshot = {
  greetingDateLabel: string;
  asOf: string;
  sessionsToday: number;
  metrics: DashboardMetric[];
  needs: DashboardNeed[];
  funnel: DashboardFunnelStage[];
  attendance: {
    days: DashboardAttendanceDay[];
    rateLast7Days: number | null;
    absencesToday: number;
    flaggedNote: string | null;
  };
};

function sydneyMonthStartUtc(dayLabelYmd: string): Date {
  // dayLabel is YYYY-MM-DD in class timezone; month starts at local midnight.
  const [y, m] = dayLabelYmd.split("-").map(Number);
  const monthStartLabel = `${y}-${String(m).padStart(2, "0")}-01`;
  return dayBoundsInClassTz(monthStartLabel).start;
}

class AdminDashboardService {
  private readonly enrollments = AppDataSource.getRepository(Enrollment);
  private readonly pendingEnrollments =
    AppDataSource.getRepository(PendingEnrollment);
  private readonly tasks = AppDataSource.getRepository(Task);
  private readonly enquiries = AppDataSource.getRepository(Enquiry);
  private readonly sessions = AppDataSource.getRepository(Session);
  private readonly attendance = AppDataSource.getRepository(AttendanceRecord);

  async getSnapshot(): Promise<AdminDashboardSnapshot> {
    const day = dayBoundsInClassTz();
    const week = clampRange(undefined, undefined);
    const monthStart = sydneyMonthStartUtc(day.label);

    const [
      activeStudents,
      trialsRunning,
      enrolledThisMonth,
      overdueTasks,
      openTasks,
      pendingEnrolments,
      absencesToday,
      sessionsToday,
      funnelRows,
      attendanceWeek,
      attendanceDays,
      openTaskRows,
      payrollTotals,
    ] = await Promise.all([
      // Spec: students with ≥1 active enrolment agreement (not merely ACTIVE user accounts).
      this.enrollments
        .createQueryBuilder("e")
        .select("COUNT(DISTINCT e.studentId)", "count")
        .where("e.status = :status", { status: EnrollmentStatus.ACTIVE })
        .getRawOne<{ count: string }>()
        .then((row) => Number(row?.count) || 0),
      this.countActiveTrials(),
      // Paid / standard agreements started this calendar month (exclude trial terms).
      this.enrollments
        .createQueryBuilder("e")
        .innerJoin("e.term", "term")
        .where("e.status = :status", { status: EnrollmentStatus.ACTIVE })
        .andWhere("term.isTrial = false")
        .andWhere("e.createdAt >= :monthStart", { monthStart })
        .getCount(),
      this.tasks
        .createQueryBuilder("task")
        .where("task.status = :status", { status: TaskStatus.OPEN })
        .andWhere("task.dueAt < :now", { now: new Date() })
        .getCount(),
      this.tasks.count({ where: { status: TaskStatus.OPEN } }),
      this.pendingEnrollments.count({
        where: { status: PendingEnrollmentStatus.PENDING },
      }),
      this.countAbsences(day.start, day.end),
      this.sessions
        .createQueryBuilder("s")
        .where("s.startAt >= :start AND s.startAt < :end", {
          start: day.start,
          end: day.end,
        })
        .getCount(),
      this.getFunnelAggregates(),
      this.getAttendanceStatusCounts(week.start, week.endExclusive),
      this.getAttendanceByDay(12),
      this.tasks.find({
        where: { status: TaskStatus.OPEN },
        order: { dueAt: "ASC" },
        take: 8,
      }),
      adminPayrollService.getMonthToDateTotals(),
    ]);

    let attendanceTotal = 0;
    let presentOrLate = 0;
    for (const row of attendanceWeek) {
      const count = Number(row.count) || 0;
      attendanceTotal += count;
      if (row.status === "PRESENT" || row.status === "LATE") {
        presentOrLate += count;
      }
    }
    const rateLast7Days =
      attendanceTotal > 0
        ? Number(((presentOrLate / attendanceTotal) * 100).toFixed(1))
        : null;

    const metrics: DashboardMetric[] = [
      {
        id: "active-students",
        label: "Active students",
        value: activeStudents,
        hint:
          activeStudents === 1
            ? "1 student with an active enrolment"
            : "With at least one active enrolment",
        tone: "up",
        info: "Distinct students who currently have at least one active enrolment agreement.",
        href: "/admin/enrolments",
      },
      {
        id: "trials",
        label: "Trials running",
        value: trialsRunning,
        hint: "Active enrolments on a trial term",
        tone: "neutral",
        info: "Active enrolments linked to a term marked as trial (not yet converted to a standard term).",
        href: "/admin/enrolments",
      },
      {
        id: "enrolled-month",
        label: "Enrolled this month",
        value: enrolledThisMonth,
        hint: "New non-trial agreements since the 1st",
        tone: "up",
        info: "Active enrolments created this calendar month on a non-trial term.",
        href: "/admin/enrolments",
      },
      {
        id: "overdue-tasks",
        label: "Overdue tasks",
        value: overdueTasks,
        hint:
          openTasks > overdueTasks
            ? `${openTasks} open in total`
            : openTasks === overdueTasks && openTasks > 0
              ? "All open tasks are overdue"
              : "Past their due time",
        tone: overdueTasks > 0 ? "danger" : "neutral",
        info: "Open ops tasks (for example absence chases) whose due time has already passed. Fee ledgers are not available on this screen.",
        href: "/admin/tasks",
      },
    ];

    if (payrollTotals) {
      metrics.push(
        {
          id: "payroll-sessions",
          label: "Sessions taken",
          value: payrollTotals.sessions,
          hint: "Payable this month (present or late)",
          tone: "neutral",
          info: "Ended sessions this month taught by a teacher with at least one present or late attendee. Used for teacher payroll.",
          href: "/admin/payroll",
        },
        {
          id: "payroll-hours",
          label: "Class hours",
          value: payrollTotals.hours,
          hint: "Hours across payable sessions",
          tone: "neutral",
          info: "Total duration of payable teacher sessions from the 1st of this month through today.",
          href: "/admin/payroll",
          format: "hours",
        },
        {
          id: "payroll-attendees",
          label: "Payroll attendees",
          value: payrollTotals.attendees,
          hint: "Present or late check-ins this month",
          tone: "neutral",
          info: "Count of present or late attendance marks on payable sessions this month.",
          href: "/admin/payroll",
        },
        {
          id: "payroll-pay",
          label: "Estimated pay",
          value: payrollTotals.amount,
          hint: "Month-to-date teacher payroll",
          tone: "up",
          info: "Estimated pay for teachers with an active rate, using the rate effective on each session day. Open Teacher payroll for the full breakdown.",
          href: "/admin/payroll",
          format: "currency",
          currency: payrollTotals.currency,
        },
      );
    }

    const needs: DashboardNeed[] = [];
    if (overdueTasks > 0) {
      needs.push({
        id: "overdue-tasks",
        title: `${overdueTasks} overdue task${overdueTasks === 1 ? "" : "s"} need attention`,
        tone: "danger",
        actionLabel: "Tasks →",
        href: "/admin/tasks",
      });
    }
    if (absencesToday > 0) {
      needs.push({
        id: "absences-today",
        title: `${absencesToday} absence${absencesToday === 1 ? "" : "s"} recorded today`,
        tone: "warn",
        actionLabel: "Attendance →",
        href: "/admin/attendance",
      });
    }
    if (pendingEnrolments > 0) {
      needs.push({
        id: "pending-enrolments",
        title: `${pendingEnrolments} enrolment${pendingEnrolments === 1 ? "" : "s"} awaiting confirmation`,
        tone: "warn",
        actionLabel: "Enrolments →",
        href: "/admin/enrolments",
      });
    }
    for (const task of openTaskRows) {
      if (needs.length >= 5) break;
      const overdue = task.dueAt.getTime() < Date.now();
      // Avoid duplicating the overdue summary with every individual overdue task.
      if (overdue && overdueTasks > 0) continue;
      needs.push({
        id: `task-${task.id}`,
        title: task.title,
        tone: overdue ? "danger" : "ok",
        actionLabel: "Open →",
        href: "/admin/tasks",
      });
    }
    if (needs.length === 0) {
      needs.push({
        id: "all-clear",
        title: "Nothing urgent right now — you’re clear for the morning.",
        tone: "ok",
        actionLabel: "Reports →",
        href: "/admin/reports",
      });
    }

    // Snapshot of where enquiries sit now — not a cohort conversion funnel.
    // Do not invent step-conversion % from adjacent stage counts.
    const maxFunnel = Math.max(1, ...funnelRows.map((r) => r.count));
    const funnel: DashboardFunnelStage[] = funnelRows.map((row) => ({
      stageName: row.stageName,
      stageCode: row.stageCode,
      count: row.count,
      widthPercent: Math.max(6, Math.round((row.count / maxFunnel) * 100)),
      conversionLabel: String(row.count),
    }));

    const lowDays = attendanceDays.filter(
      (d) => d.total > 0 && d.ratePercent < 70,
    ).length;

    return {
      greetingDateLabel: day.label,
      asOf: new Date().toISOString(),
      sessionsToday,
      metrics,
      needs,
      funnel,
      attendance: {
        days: attendanceDays,
        rateLast7Days,
        absencesToday,
        flaggedNote:
          lowDays > 0
            ? `Attendance dipped below 70% on ${lowDays} of the last ${attendanceDays.length} days.`
            : rateLast7Days != null
              ? `Present or late rate over the last 7 days: ${rateLast7Days}%.`
              : null,
      },
    };
  }

  private async countActiveTrials(): Promise<number> {
    return this.enrollments
      .createQueryBuilder("e")
      .innerJoin("e.term", "term")
      .where("e.status = :status", { status: EnrollmentStatus.ACTIVE })
      .andWhere("term.isTrial = true")
      .getCount();
  }

  private async countAbsences(start: Date, end: Date): Promise<number> {
    return this.attendance
      .createQueryBuilder("ar")
      .innerJoin("ar.session", "session")
      .where("session.startAt >= :start AND session.startAt < :end", {
        start,
        end,
      })
      .andWhere("ar.status = :status", { status: "ABSENT" })
      .getCount();
  }

  private async getFunnelAggregates(): Promise<
    Array<{ stageName: string; stageCode: string; count: number }>
  > {
    const rows = await this.enquiries
      .createQueryBuilder("enquiry")
      .innerJoin("enquiry.currentStage", "stage")
      .select("stage.name", "stageName")
      .addSelect("stage.code", "stageCode")
      .addSelect("COUNT(enquiry.id)", "count")
      .groupBy("stage.id")
      .addGroupBy("stage.name")
      .addGroupBy("stage.code")
      .addGroupBy("stage.sortOrder")
      .orderBy("stage.sortOrder", "ASC")
      .getRawMany<{ stageName: string; stageCode: string; count: string }>();

    return rows.map((row) => ({
      stageName: row.stageName,
      stageCode: row.stageCode,
      count: Number(row.count) || 0,
    }));
  }

  private async getAttendanceStatusCounts(start: Date, endExclusive: Date) {
    return this.attendance
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
  }

  private async getAttendanceByDay(
    days: number,
  ): Promise<DashboardAttendanceDay[]> {
    const end = dayBoundsInClassTz().end;
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - days);

    const rows = (await AppDataSource.query(
      `
      SELECT
        to_char(date_trunc('day', s."startAt" AT TIME ZONE 'Australia/Sydney'), 'YYYY-MM-DD') AS day,
        COUNT(ar.id)::int AS total,
        COUNT(*) FILTER (WHERE ar.status IN ('PRESENT', 'LATE'))::int AS "presentOrLate"
      FROM attendance_records ar
      INNER JOIN sessions s ON s.id = ar."sessionId"
      WHERE s."startAt" >= $1 AND s."startAt" < $2
      GROUP BY 1
      ORDER BY 1 ASC
      `,
      [start, end],
    )) as Array<{ day: string; total: number; presentOrLate: number }>;

    const byDay = new Map(rows.map((r) => [r.day, r]));
    const padded: DashboardAttendanceDay[] = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const ref = new Date();
      ref.setDate(ref.getDate() - i);
      const key = ref.toLocaleDateString("en-CA", {
        timeZone: "Australia/Sydney",
      });
      const match = byDay.get(key);
      const total = match?.total ?? 0;
      const presentOrLate = match?.presentOrLate ?? 0;
      padded.push({
        date: key,
        label: ref.toLocaleDateString("en-AU", {
          weekday: "short",
          day: "numeric",
          timeZone: "Australia/Sydney",
        }),
        presentOrLate,
        total,
        ratePercent: total > 0 ? Math.round((presentOrLate / total) * 100) : 0,
      });
    }
    return padded;
  }
}

export const adminDashboardService = new AdminDashboardService();
