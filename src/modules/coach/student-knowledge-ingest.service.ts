import { In, Not } from "typeorm";
import {
  embedText,
  embedTexts,
} from "../../common/ai/openai-client.js";
import { AppDataSource } from "../../config/data-source.js";
import { redis } from "../../config/redis.js";
import { logger } from "../../config/logger.js";
import {
  Assessment,
  AssessmentStudent,
  AssessmentSubmission,
  AttendanceRecord,
  AttendanceStatus,
  Enrollment,
  Student,
} from "../../entities/index.js";
import { studentClassesService } from "../student/classes/student-classes.service.js";
import {
  countStudentKnowledgeChunks,
  deleteStudentKnowledgeByType,
  upsertStudentKnowledgeChunk,
} from "./student-knowledge-store.js";

const INDEX_TTL_SECONDS = 60 * 60; // 1 hour
const ATTENDANCE_LOOKBACK_DAYS = 90;

function redisReadyKey(studentEntityId: string) {
  return `student-knowledge:ready:${studentEntityId}`;
}

function attendanceStatusLabel(status: AttendanceStatus | null) {
  if (!status) return "Not recorded";
  if (status === AttendanceStatus.PRESENT) return "Present";
  if (status === AttendanceStatus.LATE) return "Late";
  if (status === AttendanceStatus.EXCUSED) return "Excused";
  if (status === AttendanceStatus.ABSENT) return "Absent";
  if (status === AttendanceStatus.EXCEPTION) return "Exception";
  return status;
}

async function embedAndUpsert(
  rows: Array<{
    studentId: string;
    sourceType:
      | "enrollment"
      | "assessment"
      | "homework"
      | "attendance"
      | "summary"
      | "timetable";
    sourceId: string;
    sourceLabel: string | null;
    content: string;
    occurredOn?: string | null;
  }>,
  userId?: string,
) {
  if (rows.length === 0) return;
  const embeddings = await embedTexts(
    rows.map((row) => row.content),
    {
      feature: "student_knowledge_ingest",
      userId,
      metadata: { count: rows.length },
    },
  );
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    const embedding = embeddings[i];
    if (!embedding) continue;
    await upsertStudentKnowledgeChunk({
      ...row,
      embedding,
    });
  }
}

export class StudentKnowledgeIngestService {
  private readonly students = AppDataSource.getRepository(Student);
  private readonly enrollments = AppDataSource.getRepository(Enrollment);
  private readonly assessmentStudents =
    AppDataSource.getRepository(AssessmentStudent);
  private readonly submissions =
    AppDataSource.getRepository(AssessmentSubmission);
  private readonly attendance = AppDataSource.getRepository(AttendanceRecord);

  private async resolveStudent(studentEntityId: string) {
    const student = await this.students.findOne({
      where: { id: studentEntityId },
    });
    if (!student) return null;
    return student;
  }

  private async resolveStudentByUserId(studentUserId: string) {
    return this.students.findOne({ where: { userId: studentUserId } });
  }

  async isIndexFresh(studentEntityId: string): Promise<boolean> {
    try {
      const ready = await redis.get(redisReadyKey(studentEntityId));
      if (!ready) return false;
      const count = await countStudentKnowledgeChunks(studentEntityId);
      return count > 0;
    } catch {
      return false;
    }
  }

  async markIndexFresh(studentEntityId: string) {
    try {
      await redis.set(
        redisReadyKey(studentEntityId),
        "1",
        "EX",
        INDEX_TTL_SECONDS,
      );
    } catch (error) {
      logger.warn({ err: error }, "Failed to set student knowledge redis TTL");
    }
  }

  async invalidateIndex(studentEntityId: string) {
    try {
      await redis.del(redisReadyKey(studentEntityId));
    } catch {
      /* ignore */
    }
  }

  /**
   * Ensure student knowledge is indexed. Uses Redis 1h freshness gate.
   * Force=true rebuilds even if fresh.
   */
  async ensureIndexed(
    studentEntityId: string,
    options?: { force?: boolean; actorUserId?: string },
  ) {
    if (!options?.force && (await this.isIndexFresh(studentEntityId))) {
      return { indexed: false, reason: "fresh" as const };
    }
    await this.indexStudent(studentEntityId, options?.actorUserId);
    return { indexed: true, reason: "rebuilt" as const };
  }

  async indexStudent(studentEntityId: string, actorUserId?: string) {
    const student = await this.resolveStudent(studentEntityId);
    if (!student) {
      logger.warn({ studentEntityId }, "Student knowledge index skipped — not found");
      return;
    }

    await this.indexEnrollment(student, actorUserId);

    if (!student.userId) {
      await this.indexSummary(student, actorUserId);
      await this.markIndexFresh(studentEntityId);
      return;
    }

    await Promise.all([
      this.indexAssessments(student, actorUserId),
      this.indexHomework(student, actorUserId),
      this.indexAttendance(student, actorUserId),
      this.indexUpcomingTimetable(student, actorUserId),
    ]);
    await this.indexSummary(student, actorUserId);
    await this.markIndexFresh(studentEntityId);
  }

  async indexEnrollment(student: Student, actorUserId?: string) {
    const enrollments = await this.enrollments.find({
      where: { studentId: student.id },
      relations: { term: true, subjects: { subject: true } },
      order: { createdAt: "DESC" },
    });

    const lines = [
      `Student profile: ${student.fullName}` +
        (student.preferredName ? ` (preferred: ${student.preferredName})` : "") +
        (student.yearLevel != null ? `, year level ${student.yearLevel}` : "") +
        ".",
      student.userId
        ? "Student login account exists."
        : "Student does not have a login account yet. Timetable, attendance, homework and marks may be unavailable until a login is created.",
    ];

    if (enrollments.length === 0) {
      lines.push("No enrolments on record.");
    } else {
      for (const enrollment of enrollments) {
        const subjects =
          enrollment.subjects
            ?.map((row) => row.subject?.name)
            .filter(Boolean)
            .join(", ") || "no subjects";
        lines.push(
          `Enrolment ${enrollment.status}: term ${enrollment.term?.name ?? "unknown"}, fee ${Number(enrollment.fee)}, subjects: ${subjects}.`,
        );
      }
    }

    await embedAndUpsert(
      [
        {
          studentId: student.id,
          sourceType: "enrollment",
          sourceId: "profile",
          sourceLabel: "Enrolment & profile",
          content: lines.join("\n"),
        },
      ],
      actorUserId,
    );
  }

  async indexAssessments(student: Student, actorUserId?: string) {
    if (!student.userId) return;
    const links = await this.assessmentStudents.find({
      where: { studentId: student.userId },
      relations: { assessment: { term: true } },
      take: 100,
      order: { createdAt: "DESC" },
    });

    const assessmentIds = links.map((link) => link.assessmentId);
    const submissions =
      assessmentIds.length === 0
        ? []
        : await this.submissions.find({
            where: {
              studentId: student.userId,
              assessmentId: In(assessmentIds),
              status: Not("DRAFT" as AssessmentSubmission["status"]),
            },
          });
    const byAssessment = new Map(
      submissions.map((row) => [row.assessmentId, row]),
    );

    const rows = links
      .filter(
        (link) =>
          link.assessment &&
          link.assessment.status !== "ARCHIVED" &&
          link.assessment.status !== "CANCELLED",
      )
      .map((link) => {
        const assessment = link.assessment as Assessment;
        const submission = byAssessment.get(link.assessmentId);
        const mark =
          submission?.mark != null ? Number(submission.mark) : null;
        const total =
          assessment.totalMarks != null ? Number(assessment.totalMarks) : null;
        const content = [
          `${assessment.kind === "ENTRANCE" ? "Entrance exam" : "Assessment"}: ${assessment.name}.`,
          `Subject: ${assessment.subject}. Date: ${assessment.assessmentDate}. Term: ${assessment.term?.name ?? "n/a"}.`,
          submission
            ? `Submission status: ${submission.status}. Mark: ${mark ?? "not marked"}${total != null ? ` / ${total}` : ""}.${submission.markNotes ? ` Notes: ${submission.markNotes}` : ""}`
            : "No submitted/marked result yet.",
        ].join(" ");
        return {
          studentId: student.id,
          sourceType: "assessment" as const,
          sourceId: assessment.id,
          sourceLabel: assessment.name,
          content,
          occurredOn: assessment.assessmentDate || null,
        };
      });

    await deleteStudentKnowledgeByType(student.id, "assessment");
    await embedAndUpsert(rows, actorUserId);
  }

  async indexHomework(student: Student, actorUserId?: string) {
    if (!student.userId) return;
    const data = await studentClassesService.listHomework(student.userId);
    const rows = data.homework.map((item) => {
      const status = item.submission?.status ?? "NOT_STARTED";
      return {
        studentId: student.id,
        sourceType: "homework" as const,
        sourceId: item.id,
        sourceLabel: item.title,
        content: [
          `Homework: ${item.title}.`,
          `Subject: ${item.subject ?? "n/a"}. Due: ${item.dueDate}.`,
          `Submission status: ${status}.`,
          item.description ? `Details: ${item.description}` : "",
        ]
          .filter(Boolean)
          .join(" "),
        occurredOn: item.dueDate?.slice(0, 10) ?? null,
      };
    });
    await deleteStudentKnowledgeByType(student.id, "homework");
    await embedAndUpsert(rows, actorUserId);
  }

  async indexAttendance(student: Student, actorUserId?: string) {
    if (!student.userId) return;

    const since = new Date();
    since.setDate(since.getDate() - ATTENDANCE_LOOKBACK_DAYS);
    since.setHours(0, 0, 0, 0);

    const records = await this.attendance.find({
      where: { studentId: student.userId },
      relations: { session: { class: true } },
      order: { createdAt: "DESC" },
      take: 200,
    });

    const recent = records.filter(
      (record) =>
        record.session?.startAt &&
        new Date(record.session.startAt).getTime() >= since.getTime(),
    );

    const rows = recent.map((record) => {
      const session = record.session;
      const startAt = session?.startAt
        ? new Date(session.startAt).toISOString()
        : null;
      const className =
        session?.class?.name ?? session?.class?.code ?? "Class";
      const day = startAt?.slice(0, 10) ?? null;
      return {
        studentId: student.id,
        sourceType: "attendance" as const,
        sourceId: record.sessionId,
        sourceLabel: `${className} attendance`,
        content: `Attendance on ${day ?? "unknown date"} for ${className}: ${attendanceStatusLabel(record.status)}.${record.scannedAt ? ` Scanned at ${record.scannedAt.toISOString()}.` : ""}`,
        occurredOn: day,
      };
    });

    await deleteStudentKnowledgeByType(student.id, "attendance");
    await embedAndUpsert(rows, actorUserId);
  }

  async indexUpcomingTimetable(student: Student, actorUserId?: string) {
    if (!student.userId) return;
    try {
      const upcoming = await studentClassesService.listUpcomingSessions(
        student.userId,
        { range: "initial" },
      );
      if (upcoming.range !== "initial") return;

      const compact = (lessons: typeof upcoming.today) =>
        lessons
          .map((lesson) => {
            const day = lesson.startAt.slice(0, 10);
            const time = lesson.startAt.slice(11, 16);
            return `${day} ${time} ${lesson.subject} (${lesson.className}) [${lesson.kind}]`;
          })
          .join("; ");

      const content = [
        `Upcoming schedule for ${student.fullName}.`,
        `Today: ${compact(upcoming.today) || "none"}.`,
        `This week: ${compact(upcoming.thisWeek) || "none"}.`,
        `Next week: ${compact(upcoming.nextWeek) || "none"}.`,
      ].join("\n");

      await embedAndUpsert(
        [
          {
            studentId: student.id,
            sourceType: "timetable",
            sourceId: "upcoming",
            sourceLabel: "Upcoming timetable",
            content,
          },
        ],
        actorUserId,
      );
    } catch (error) {
      logger.warn(
        { err: error, studentId: student.id },
        "Failed to index upcoming timetable",
      );
    }
  }

  async indexSummary(student: Student, actorUserId?: string) {
    const lines = [`Performance summary for ${student.fullName}.`];

    if (!student.userId) {
      lines.push(
        "No student login — cannot compute attendance, homework, or assessment summary.",
      );
    } else {
      try {
        const [homework, attendanceRows] = await Promise.all([
          studentClassesService.listHomework(student.userId),
          this.attendance.find({
            where: { studentId: student.userId },
            take: 200,
            order: { createdAt: "DESC" },
          }),
        ]);

        const now = Date.now();
        const submitted = homework.homework.filter(
          (row) => row.submission?.status === "SUBMITTED",
        ).length;
        const overdue = homework.homework.filter((row) => {
          const due = new Date(row.dueDate).getTime();
          return (
            Number.isFinite(due) &&
            due < now &&
            row.submission?.status !== "SUBMITTED"
          );
        }).length;

        const presentish = attendanceRows.filter(
          (row) =>
            row.status === AttendanceStatus.PRESENT ||
            row.status === AttendanceStatus.LATE ||
            row.status === AttendanceStatus.EXCUSED,
        ).length;
        const absent = attendanceRows.filter(
          (row) => row.status === AttendanceStatus.ABSENT,
        ).length;
        const total = attendanceRows.length;
        const percent =
          total > 0 ? Math.round((presentish / total) * 100) : null;

        lines.push(
          `Attendance (recent records): ${percent != null ? `${percent}%` : "n/a"} across ${total} recorded sessions (${absent} absent).`,
        );
        lines.push(
          `Homework: ${homework.homework.length} assigned, ${submitted} submitted, ${overdue} overdue.`,
        );

        const links = await this.assessmentStudents.find({
          where: { studentId: student.userId },
          take: 50,
        });
        const assessmentIds = links.map((l) => l.assessmentId);
        const marked =
          assessmentIds.length === 0
            ? []
            : await this.submissions.find({
                where: {
                  studentId: student.userId,
                  assessmentId: In(assessmentIds),
                  status: Not("DRAFT" as AssessmentSubmission["status"]),
                },
              });
        const withMarks = marked.filter((row) => row.mark != null);
        const avg =
          withMarks.length > 0
            ? Math.round(
                (withMarks.reduce((sum, row) => sum + Number(row.mark), 0) /
                  withMarks.length) *
                  10,
              ) / 10
            : null;
        lines.push(
          `Assessments: ${withMarks.length} marked results` +
            (avg != null ? `, average mark ${avg}` : "") +
            ".",
        );
      } catch (error) {
        lines.push(`Summary details unavailable: ${String(error)}`);
      }
    }

    await embedAndUpsert(
      [
        {
          studentId: student.id,
          sourceType: "summary",
          sourceId: "overall",
          sourceLabel: "Overall performance summary",
          content: lines.join("\n"),
        },
      ],
      actorUserId,
    );
  }

  /** Append/upsert a single attendance session chunk (realtime hook). */
  async upsertAttendanceForUser(
    studentUserId: string,
    sessionId: string,
    actorUserId?: string,
  ) {
    const student = await this.resolveStudentByUserId(studentUserId);
    if (!student) return;

    const record = await this.attendance.findOne({
      where: { studentId: studentUserId, sessionId },
      relations: { session: { class: true } },
    });
    if (!record?.session) return;

    const startAt = new Date(record.session.startAt).toISOString();
    const day = startAt.slice(0, 10);
    const className =
      record.session.class?.name ?? record.session.class?.code ?? "Class";
    const content = `Attendance on ${day} for ${className}: ${attendanceStatusLabel(record.status)}.${record.scannedAt ? ` Scanned at ${record.scannedAt.toISOString()}.` : ""}`;

    const embedding = await embedText(content, {
      feature: "student_knowledge_ingest",
      userId: actorUserId,
      metadata: { sourceType: "attendance", sessionId },
    });

    await upsertStudentKnowledgeChunk({
      studentId: student.id,
      sourceType: "attendance",
      sourceId: sessionId,
      sourceLabel: `${className} attendance`,
      content,
      embedding,
      occurredOn: day,
    });

    // Keep overall summary reasonably fresh without full rebuild.
    await this.indexSummary(student, actorUserId);
  }

  async upsertAssessmentForUser(
    studentUserId: string,
    assessmentId: string,
    actorUserId?: string,
  ) {
    const student = await this.resolveStudentByUserId(studentUserId);
    if (!student) return;
    await this.indexAssessments(student, actorUserId);
    await this.indexSummary(student, actorUserId);
  }

  async upsertEnrollmentForStudent(
    studentEntityId: string,
    actorUserId?: string,
  ) {
    const student = await this.resolveStudent(studentEntityId);
    if (!student) return;
    await this.indexEnrollment(student, actorUserId);
    await this.indexSummary(student, actorUserId);
    await this.invalidateIndex(studentEntityId);
  }
}

export const studentKnowledgeIngestService =
  new StudentKnowledgeIngestService();

export function queueStudentKnowledgeIngest(
  run: () => Promise<unknown>,
  label: string,
) {
  void run().catch((error) => {
    logger.warn({ err: error }, `Student knowledge ingest failed: ${label}`);
  });
}
