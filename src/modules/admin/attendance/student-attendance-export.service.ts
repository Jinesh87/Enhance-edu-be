import { In, IsNull } from "typeorm";
import { AppDataSource } from "../../../config/data-source.js";
import { AppError } from "../../../common/errors/AppError.js";
import { UserRole } from "../../../common/constants/roles.js";
import { writeAuditLog } from "../../../common/utils/audit-log.js";
import {
  DEFAULT_CLASS_TIMEZONE,
  formatInTimeZone,
} from "../../../common/utils/timezone.js";
import {
  AcademicYear,
  AssessmentStudent,
  AttendanceRecord,
  AttendanceStatus,
  ClassStudent,
  Session,
  Subject,
  Term,
  User,
} from "../../../entities/index.js";
import {
  buildClassJoinAtMap,
  isStudentAccountableForSession,
} from "../../shared/attendance/student-session-eligibility.js";
import {
  createAttendanceReportId,
  formatAttendanceGeneratedAt,
  renderStudentAttendanceReportPdf,
  type AttendanceDetailRow,
  type AttendanceSubjectSummaryRow,
  type StudentAttendanceReportInput,
} from "./student-attendance-report-pdf.js";

export type ExportStudentAttendanceInput = {
  studentId: string;
  academicYearId: string;
  termId: string;
  subjectId?: string | "all";
  actorUserId?: string;
};

export type ExportStudentAttendanceResult = {
  buffer: Buffer;
  filename: string;
  reportId: string;
};

export type BuiltAttendanceReport = {
  report: StudentAttendanceReportInput;
  filenameBase: string;
  studentId: string;
  academicYearId: string;
  termId: string;
  subjectId: string | "all";
};

type SessionRow = {
  session: Session;
  subject: string;
  sessionLabel: string;
  timeZone: string | null;
};

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  [AttendanceStatus.PRESENT]: "Present",
  [AttendanceStatus.LATE]: "Late",
  [AttendanceStatus.ABSENT]: "Absent",
  [AttendanceStatus.EXCUSED]: "Excused",
  [AttendanceStatus.EXCEPTION]: "Exception",
  [AttendanceStatus.PENDING]: "Pending",
};

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return slug || "report";
}

function formatRate(attended: number, expected: number): string {
  if (expected <= 0) return "N/A";
  return `${((attended / expected) * 100).toFixed(1)}%`;
}

function countsForStatuses(statuses: AttendanceStatus[]) {
  let present = 0;
  let late = 0;
  let absent = 0;
  let excused = 0;

  for (const status of statuses) {
    if (status === AttendanceStatus.PRESENT) present += 1;
    else if (status === AttendanceStatus.LATE) late += 1;
    else if (status === AttendanceStatus.EXCUSED) excused += 1;
    else if (
      status === AttendanceStatus.ABSENT ||
      status === AttendanceStatus.EXCEPTION ||
      status === AttendanceStatus.PENDING
    ) {
      absent += 1;
    }
  }

  const expected = statuses.length;
  const attended = present + late + excused;
  return {
    expected,
    present,
    late,
    absent,
    excused,
    attendanceRateLabel: formatRate(attended, expected),
  };
}

function subjectMatches(
  sessionSubject: string,
  selectedSubjectName: string | null,
): boolean {
  if (!selectedSubjectName) return true;
  return (
    sessionSubject.trim().toLowerCase() ===
    selectedSubjectName.trim().toLowerCase()
  );
}

function formatSessionDate(startAt: Date, timeZone?: string | null): string {
  return (
    formatInTimeZone(startAt.toISOString(), timeZone, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    }) || "—"
  );
}

export class StudentAttendanceExportService {
  async buildReport(
    input: Omit<ExportStudentAttendanceInput, "actorUserId">,
  ): Promise<BuiltAttendanceReport> {
    const subjectFilter =
      !input.subjectId || input.subjectId === "all" ? null : input.subjectId;

    const [student, academicYear, term, subject] = await Promise.all([
      AppDataSource.getRepository(User).findOne({
        where: { id: input.studentId },
        select: {
          id: true,
          fullName: true,
          preferredName: true,
          username: true,
          role: true,
        },
      }),
      AppDataSource.getRepository(AcademicYear).findOne({
        where: { id: input.academicYearId },
      }),
      AppDataSource.getRepository(Term).findOne({
        where: { id: input.termId },
        relations: {
          academicYear: true,
          yearLevel: true,
          classroom: true,
        },
      }),
      subjectFilter
        ? AppDataSource.getRepository(Subject).findOne({
            where: { id: subjectFilter },
          })
        : Promise.resolve(null),
    ]);

    if (!student || student.role !== UserRole.STUDENT) {
      throw new AppError(404, "Student not found", "STUDENT_NOT_FOUND");
    }
    if (!academicYear) {
      throw new AppError(
        404,
        "Academic year not found",
        "ACADEMIC_YEAR_NOT_FOUND",
      );
    }
    if (!term) {
      throw new AppError(404, "Term not found", "TERM_NOT_FOUND");
    }
    if (term.academicYear?.id !== academicYear.id) {
      throw new AppError(
        400,
        "Selected term does not belong to the academic year",
        "TERM_YEAR_MISMATCH",
      );
    }
    if (subjectFilter && !subject) {
      throw new AppError(404, "Subject not found", "SUBJECT_NOT_FOUND");
    }

    const selectedSubjectName = subject?.name ?? null;
    const sessionRows = await this.collectAccountableSessions({
      studentId: student.id,
      termId: term.id,
      selectedSubjectName,
    });

    if (sessionRows.length === 0) {
      throw new AppError(
        422,
        "No attendance records were found for this student, term, and subject.",
        "NO_ATTENDANCE_RECORDS",
      );
    }

    const attendanceRecords = await AppDataSource.getRepository(
      AttendanceRecord,
    ).find({
      where: {
        studentId: student.id,
        sessionId: In(sessionRows.map((row) => row.session.id)),
      },
    });
    const bySession = new Map(
      attendanceRecords.map((record) => [record.sessionId, record]),
    );

    const detailStatuses: AttendanceStatus[] = [];
    const details: AttendanceDetailRow[] = [];
    const bySubject = new Map<string, AttendanceStatus[]>();

    for (const row of sessionRows) {
      const record = bySession.get(row.session.id);
      const status = record?.status ?? AttendanceStatus.ABSENT;
      detailStatuses.push(status);

      const subjectStatuses = bySubject.get(row.subject) ?? [];
      subjectStatuses.push(status);
      bySubject.set(row.subject, subjectStatuses);

      const isPresent = status === AttendanceStatus.PRESENT;
      const reason =
        !isPresent && record?.manualReason?.trim()
          ? record.manualReason.trim()
          : "—";

      details.push({
        dateLabel: formatSessionDate(row.session.startAt, row.timeZone),
        subject: row.subject || "—",
        sessionLabel: row.sessionLabel || "—",
        status,
        statusLabel: STATUS_LABEL[status] ?? status,
        reason,
        note: "—",
      });
    }

    const summary = countsForStatuses(detailStatuses);
    const subjectSummary: AttendanceSubjectSummaryRow[] =
      !selectedSubjectName && bySubject.size > 0
        ? Array.from(bySubject.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([subjectName, statuses]) => {
              const counts = countsForStatuses(statuses);
              return {
                subject: subjectName,
                expected: counts.expected,
                present: counts.present,
                absent: counts.absent,
                late: counts.late,
                attendanceRateLabel: counts.attendanceRateLabel,
              };
            })
        : [];

    const classCodes = Array.from(
      new Set(
        sessionRows
          .map((row) => row.session.class?.code)
          .filter((code): code is string => Boolean(code?.trim())),
      ),
    ).sort((a, b) => a.localeCompare(b));

    const report: StudentAttendanceReportInput = {
      reportId: createAttendanceReportId(),
      generatedAtLabel: formatAttendanceGeneratedAt(),
      studentName: student.fullName,
      studentIdentifier: student.username?.trim() || "—",
      yearLevel: term.yearLevel?.name ?? "—",
      classSection:
        term.classroom?.name ||
        (classCodes.length > 0 ? classCodes.join(", ") : "—"),
      academicYearLabel:
        academicYear.displayName || String(academicYear.year),
      termName: term.name,
      subjectLabel: selectedSubjectName ?? "All subjects",
      summary,
      subjectSummary,
      details,
    };

    return {
      report,
      filenameBase: [
        "attendance",
        slugify(student.fullName),
        slugify(String(academicYear.year)),
        slugify(term.name),
      ].join("-"),
      studentId: student.id,
      academicYearId: academicYear.id,
      termId: term.id,
      subjectId: subjectFilter ?? "all",
    };
  }

  async preview(
    input: Omit<ExportStudentAttendanceInput, "actorUserId">,
  ): Promise<StudentAttendanceReportInput> {
    const built = await this.buildReport(input);
    return built.report;
  }

  async exportPdf(
    input: ExportStudentAttendanceInput,
  ): Promise<ExportStudentAttendanceResult> {
    const built = await this.buildReport(input);
    const buffer = renderStudentAttendanceReportPdf(built.report);

    if (input.actorUserId) {
      try {
        await writeAuditLog({
          actorUserId: input.actorUserId,
          action: "EXPORTED",
          recordType: "attendance_report",
          recordId: built.studentId,
          recordLabel: `${built.report.studentName} · ${built.report.termName}`,
          recordPath: "/admin/attendance/export",
          after: {
            action: "ATTENDANCE_REPORT_EXPORTED",
            studentId: built.studentId,
            academicYearId: built.academicYearId,
            termId: built.termId,
            subjectId: built.subjectId,
            format: "PDF",
            reportId: built.report.reportId,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        console.error("Attendance export audit logging failed:", error);
      }
    }

    return {
      buffer,
      filename: `${built.filenameBase}.pdf`,
      reportId: built.report.reportId,
    };
  }

  private async collectAccountableSessions(params: {
    studentId: string;
    termId: string;
    selectedSubjectName: string | null;
  }): Promise<SessionRow[]> {
    const now = new Date();
    const enrolments = await AppDataSource.getRepository(ClassStudent).find({
      where: { studentId: params.studentId },
      relations: {
        class: {
          term: true,
        },
      },
    });

    const termEnrolments = enrolments.filter(
      (row) => row.class?.term?.id === params.termId,
    );
    const joinAtByClassId = buildClassJoinAtMap(termEnrolments);
    const classIds = [
      ...new Set(
        termEnrolments
          .filter((row) => {
            const cls = row.class;
            if (!cls) return false;
            const subject = cls.subject || cls.name || "Class";
            return subjectMatches(subject, params.selectedSubjectName);
          })
          .map((row) => row.classId),
      ),
    ];

    const classSessions =
      classIds.length > 0
        ? await AppDataSource.getRepository(Session).find({
            where: {
              classId: In(classIds),
              assessmentId: IsNull(),
            },
            relations: { class: true },
            order: { startAt: "ASC" },
          })
        : [];

    const assessmentLinks = await AppDataSource.getRepository(
      AssessmentStudent,
    ).find({
      where: { studentId: params.studentId },
      relations: {
        assessment: {
          term: true,
        },
      },
    });

    const assessmentIds = assessmentLinks
      .filter((link) => link.assessment?.term?.id === params.termId)
      .filter((link) =>
        subjectMatches(
          link.assessment?.subject || link.assessment?.name || "Assessment",
          params.selectedSubjectName,
        ),
      )
      .map((link) => link.assessmentId);

    const assessmentSessions =
      assessmentIds.length > 0
        ? await AppDataSource.getRepository(Session).find({
            where: {
              assessmentId: In(assessmentIds),
              classId: IsNull(),
            },
            relations: { assessment: true },
            order: { startAt: "ASC" },
          })
        : [];

    const rows: SessionRow[] = [];

    for (const session of classSessions) {
      if (session.endAt.getTime() >= now.getTime()) continue;
      if (!session.classId) continue;
      const joinedAt = joinAtByClassId.get(session.classId);
      if (!joinedAt || !isStudentAccountableForSession(session, joinedAt)) {
        continue;
      }
      const subject = session.class?.subject || session.class?.name || "Class";
      rows.push({
        session,
        subject,
        sessionLabel: `${session.class?.code ?? "Class"} · ${session.class?.name ?? "Session"}`,
        timeZone: session.class?.timeZone ?? DEFAULT_CLASS_TIMEZONE,
      });
    }

    for (const session of assessmentSessions) {
      if (session.endAt.getTime() >= now.getTime()) continue;
      const subject =
        session.assessment?.subject ||
        session.assessment?.name ||
        "Assessment";
      rows.push({
        session,
        subject,
        sessionLabel: session.assessment?.name ?? "Assessment",
        timeZone: session.assessment?.timeZone ?? DEFAULT_CLASS_TIMEZONE,
      });
    }

    rows.sort(
      (a, b) => a.session.startAt.getTime() - b.session.startAt.getTime(),
    );
    return rows;
  }
}

export const studentAttendanceExportService =
  new StudentAttendanceExportService();
