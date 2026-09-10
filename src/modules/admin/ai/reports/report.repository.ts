import { AttendanceStatus } from "../../../../entities/AttendanceRecord.js";
import { TaskStatus } from "../../../../entities/Task.js";
import {
  calendarDateInTimeZone,
  DEFAULT_CLASS_TIMEZONE,
  formatInTimeZone,
} from "../../../../common/utils/timezone.js";
import { adminAiRepository } from "../admin-ai.repository.js";
import {
  clampRange,
  dayBoundsInClassTz,
  formatLocalSessionTime,
} from "../tool-helpers.js";
import {
  REPORT_MAX_ROWS,
  reportTypeLabel,
  type AdminAiReportFilters,
  type AdminAiReportType,
  type ReportTablePayload,
} from "./report.types.js";

function pushFilter(
  labels: string[],
  label: string,
  value: string | number | null | undefined,
) {
  if (value == null || value === "") return;
  labels.push(`${label}: ${value}`);
}

export class AdminAiReportRepository {
  async buildPayload(
    reportType: AdminAiReportType,
    filters: AdminAiReportFilters,
  ): Promise<ReportTablePayload> {
    switch (reportType) {
      case "ATTENDANCE_SUMMARY":
        return this.attendanceSummary(filters);
      case "LOW_ATTENDANCE_STUDENTS":
        return this.lowAttendanceStudents(filters);
      case "LOW_ATTENDANCE_CLASSES":
        return this.lowAttendanceClasses(filters);
      case "ENROLMENTS":
        return this.enrolments(filters);
      case "ENQUIRIES":
        return this.enquiries(filters);
      case "ASSESSMENTS":
        return this.assessments(filters);
      case "TIMETABLE":
        return this.timetable(filters);
      case "TASKS":
        return this.tasks(filters);
    }
  }

  private attendanceSummary(
    filters: AdminAiReportFilters,
  ): Promise<ReportTablePayload> {
    const { start, end, endExclusive } = clampRange(
      filters.startDate ?? undefined,
      filters.endDate ?? undefined,
    );
    return adminAiRepository
      .getAttendanceStatusCounts(start, endExclusive)
      .then((rows) => {
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
        const rate =
          total > 0 ? `${((present / total) * 100).toFixed(1)}%` : "—";
        const filterLabels: string[] = [];
        pushFilter(filterLabels, "From", start.toISOString().slice(0, 10));
        pushFilter(filterLabels, "To", end.toISOString().slice(0, 10));
        pushFilter(filterLabels, "Year", filters.yearLevel);
        pushFilter(filterLabels, "Subject", filters.subject);

        const tableRows = Object.entries(byStatus)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([status, count]) => [status, String(count)]);

        return {
          title: reportTypeLabel("ATTENDANCE_SUMMARY"),
          filterLabels,
          summary: [
            { label: "Total records", value: String(total) },
            { label: "Present or late rate", value: rate },
          ],
          columns: ["Status", "Count"],
          rows: tableRows.slice(0, REPORT_MAX_ROWS),
          truncated: tableRows.length > REPORT_MAX_ROWS,
        };
      });
  }

  private async lowAttendanceStudents(
    filters: AdminAiReportFilters,
  ): Promise<ReportTablePayload> {
    const threshold = Math.min(
      100,
      Math.max(1, Number(filters.threshold) || 80),
    );
    const { start, end, endExclusive } = clampRange(
      filters.startDate ?? undefined,
      filters.endDate ?? undefined,
    );
    const rows = await adminAiRepository.getLowAttendanceStudentAggregates(
      start,
      endExclusive,
      {
        thresholdPercent: threshold,
        subject: filters.subject,
        limit: REPORT_MAX_ROWS + 1,
      },
    );
    const limited = rows.slice(0, REPORT_MAX_ROWS);
    const filterLabels: string[] = [];
    pushFilter(filterLabels, "From", start.toISOString().slice(0, 10));
    pushFilter(filterLabels, "To", end.toISOString().slice(0, 10));
    pushFilter(filterLabels, "Threshold", `< ${threshold}%`);
    pushFilter(filterLabels, "Subject", filters.subject);
    pushFilter(filterLabels, "Year", filters.yearLevel);

    return {
      title: reportTypeLabel("LOW_ATTENDANCE_STUDENTS"),
      filterLabels,
      summary: [{ label: "Students listed", value: String(limited.length) }],
      columns: ["Student", "Subject", "Class", "Rate", "Present/Sessions"],
      rows: limited.map((row) => {
        const total = Number(row.totalRecords) || 0;
        const present = Number(row.presentOrLate) || 0;
        const rate = total > 0 ? ((present / total) * 100).toFixed(1) : "0.0";
        return [
          String(row.studentName ?? "Unknown"),
          String(row.primarySubject ?? "—"),
          String(row.primaryClassName ?? "—"),
          `${rate}%`,
          `${present}/${total}`,
        ];
      }),
      truncated: rows.length > REPORT_MAX_ROWS,
    };
  }

  private async lowAttendanceClasses(
    filters: AdminAiReportFilters,
  ): Promise<ReportTablePayload> {
    const threshold = Math.min(
      100,
      Math.max(1, Number(filters.threshold) || 80),
    );
    const { start, end, endExclusive } = clampRange(
      filters.startDate ?? undefined,
      filters.endDate ?? undefined,
    );
    const rows = await adminAiRepository.getLowAttendanceClassAggregates(
      start,
      endExclusive,
      REPORT_MAX_ROWS + 1,
    );
    const filtered = rows
      .map((row) => {
        const total = Number(row.totalRecords) || 0;
        const present = Number(row.presentOrLate) || 0;
        const rate = total > 0 ? (present / total) * 100 : 0;
        return {
          className: String(row.className ?? ""),
          subject: row.subject ? String(row.subject) : "—",
          total,
          present,
          rate,
        };
      })
      .filter((row) => row.rate < threshold);
    const limited = filtered.slice(0, REPORT_MAX_ROWS);
    const filterLabels: string[] = [];
    pushFilter(filterLabels, "From", start.toISOString().slice(0, 10));
    pushFilter(filterLabels, "To", end.toISOString().slice(0, 10));
    pushFilter(filterLabels, "Threshold", `< ${threshold}%`);

    return {
      title: reportTypeLabel("LOW_ATTENDANCE_CLASSES"),
      filterLabels,
      summary: [{ label: "Classes listed", value: String(limited.length) }],
      columns: ["Class", "Subject", "Rate", "Present/Sessions"],
      rows: limited.map((row) => [
        row.className,
        row.subject,
        `${row.rate.toFixed(1)}%`,
        `${row.present}/${row.total}`,
      ]),
      truncated: filtered.length > REPORT_MAX_ROWS,
    };
  }

  private async enrolments(
    filters: AdminAiReportFilters,
  ): Promise<ReportTablePayload> {
    const active = await adminAiRepository.findActiveEnrollmentsForEnrolmentSearch(
      {
        studentName: null,
        subject: filters.subject,
        yearLevel: filters.yearLevel,
        term: filters.term,
        academicYear: filters.academicYear,
      },
    );
    const rows: string[][] = [];
    for (const enrollment of active) {
      if (rows.length >= REPORT_MAX_ROWS) break;
      const subjects = (enrollment.subjects ?? [])
        .map((row) => row.subject?.name?.trim())
        .filter((value): value is string => Boolean(value))
        .join(", ");
      rows.push([
        enrollment.student?.fullName?.trim() || "—",
        "ACTIVE",
        enrollment.term?.yearLevel?.name ?? "—",
        enrollment.term?.name ?? "—",
        subjects || "—",
      ]);
    }
    const filterLabels: string[] = [];
    pushFilter(filterLabels, "Year", filters.yearLevel);
    pushFilter(filterLabels, "Term", filters.term);
    pushFilter(filterLabels, "Subject", filters.subject);
    pushFilter(filterLabels, "Academic year", filters.academicYear);

    return {
      title: reportTypeLabel("ENROLMENTS"),
      filterLabels,
      summary: [{ label: "Enrolments listed", value: String(rows.length) }],
      columns: ["Student", "Status", "Year", "Term", "Subjects"],
      rows,
      truncated: active.length > REPORT_MAX_ROWS,
    };
  }

  private async enquiries(
    filters: AdminAiReportFilters,
  ): Promise<ReportTablePayload> {
    const enquiries = await adminAiRepository.findEnquiries({
      studentName: null,
      guardianName: null,
      stage: filters.status,
      subject: filters.subject,
      yearLevel: filters.yearLevel,
    });
    const limited = enquiries.slice(0, REPORT_MAX_ROWS);
    const filterLabels: string[] = [];
    pushFilter(filterLabels, "Year", filters.yearLevel);
    pushFilter(filterLabels, "Subject", filters.subject);
    pushFilter(filterLabels, "Stage", filters.status);

    return {
      title: reportTypeLabel("ENQUIRIES"),
      filterLabels,
      summary: [{ label: "Enquiries listed", value: String(limited.length) }],
      columns: ["Student", "Guardian", "Stage", "Subject", "Year", "Owner"],
      rows: limited.map((enquiry) => [
        enquiry.studentFullName?.trim() || "—",
        enquiry.guardianFullName?.trim() || "—",
        enquiry.currentStage?.name ?? "—",
        enquiry.subjectOfInterest?.trim() || "—",
        enquiry.yearLevel != null ? `Year ${enquiry.yearLevel}` : "—",
        enquiry.owner?.fullName?.trim() || "—",
      ]),
      truncated: enquiries.length > REPORT_MAX_ROWS,
    };
  }

  private async assessments(
    filters: AdminAiReportFilters,
  ): Promise<ReportTablePayload> {
    const assessments = await adminAiRepository.findAssessments({
      subject: filters.subject,
      yearLevel: filters.yearLevel,
      term: filters.term,
      status: filters.status,
      name: null,
    });
    const limited = assessments.slice(0, REPORT_MAX_ROWS);
    const filterLabels: string[] = [];
    pushFilter(filterLabels, "Year", filters.yearLevel);
    pushFilter(filterLabels, "Term", filters.term);
    pushFilter(filterLabels, "Subject", filters.subject);
    pushFilter(filterLabels, "Status", filters.status);

    return {
      title: reportTypeLabel("ASSESSMENTS"),
      filterLabels,
      summary: [{ label: "Assessments listed", value: String(limited.length) }],
      columns: ["Assessment", "Subject", "Year", "Term", "Date", "Status"],
      rows: limited.map((item) => [
        item.name,
        item.subject || "—",
        item.yearGroup || item.term?.yearLevel?.name || "—",
        item.term?.name ?? "—",
        item.assessmentDate || "—",
        item.status,
      ]),
      truncated: assessments.length > REPORT_MAX_ROWS,
    };
  }

  private async timetable(
    filters: AdminAiReportFilters,
  ): Promise<ReportTablePayload> {
    let start: Date;
    let end: Date;
    let rangeLabel: string;
    if (!filters.startDate && !filters.endDate) {
      const day = dayBoundsInClassTz();
      start = day.start;
      end = day.end;
      rangeLabel = day.label;
    } else {
      const range = clampRange(
        filters.startDate ?? undefined,
        filters.endDate ?? undefined,
      );
      start = range.start;
      end = range.endExclusive;
      const maxEnd = new Date(start);
      maxEnd.setUTCDate(maxEnd.getUTCDate() + 14);
      if (end > maxEnd) end = maxEnd;
      rangeLabel = `${range.start.toISOString().slice(0, 10)}–${new Date(end.getTime() - 1).toISOString().slice(0, 10)}`;
    }

    const sessions = await adminAiRepository.findSessionsInRange(start, end, {
      yearLevel: filters.yearLevel,
      subject: filters.subject,
    });
    const limited = sessions.slice(0, REPORT_MAX_ROWS);
    const filterLabels: string[] = [];
    pushFilter(filterLabels, "Range", rangeLabel);
    pushFilter(filterLabels, "Year", filters.yearLevel);
    pushFilter(filterLabels, "Subject", filters.subject);

    return {
      title: reportTypeLabel("TIMETABLE"),
      filterLabels,
      summary: [{ label: "Sessions listed", value: String(limited.length) }],
      columns: ["Date", "Time", "Class", "Subject", "Teacher", "Room"],
      rows: limited.map((session) => {
        const local = formatLocalSessionTime(
          session.startAt,
          session.endAt,
          session.class?.timeZone,
        );
        const teacher =
          session.teacher?.fullName?.trim() ||
          session.class?.teacher?.fullName?.trim() ||
          "—";
        return [
          calendarDateInTimeZone(
            session.startAt,
            session.class?.timeZone ?? DEFAULT_CLASS_TIMEZONE,
          ),
          `${local.startTime}–${local.endTime}`,
          session.class?.name ?? session.assessment?.name ?? "—",
          session.class?.subject ?? session.assessment?.subject ?? "—",
          teacher,
          session.classroom?.name ??
            session.room ??
            session.class?.room ??
            "—",
        ];
      }),
      truncated: sessions.length > REPORT_MAX_ROWS,
    };
  }

  private async tasks(
    filters: AdminAiReportFilters,
  ): Promise<ReportTablePayload> {
    const statusRaw = filters.status?.trim().toUpperCase() || "OPEN";
    const status =
      statusRaw === "DONE" || statusRaw === "ALL" ? statusRaw : "OPEN";
    const tasks = await adminAiRepository.findTasks({
      status,
      studentName: null,
    });
    const limited = tasks.slice(0, REPORT_MAX_ROWS);
    const filterLabels: string[] = [];
    pushFilter(filterLabels, "Status", status);

    return {
      title: reportTypeLabel("TASKS"),
      filterLabels,
      summary: [
        {
          label: "Open tasks (system)",
          value: String(
            status === "OPEN"
              ? await adminAiRepository.countOpenTasks()
              : limited.length,
          ),
        },
      ],
      columns: ["Task", "Student", "Status", "Due", "Class"],
      rows: limited.map((task) => {
        const due = formatInTimeZone(
          task.dueAt,
          task.session?.class?.timeZone ?? DEFAULT_CLASS_TIMEZONE,
          {
            day: "2-digit",
            month: "short",
            year: "numeric",
          },
        );
        return [
          task.title,
          task.student?.fullName?.trim() || "—",
          task.status === TaskStatus.OPEN ? "OPEN" : String(task.status),
          due,
          task.session?.class?.name ?? "—",
        ];
      }),
      truncated: tasks.length > REPORT_MAX_ROWS,
    };
  }
}

export const adminAiReportRepository = new AdminAiReportRepository();
