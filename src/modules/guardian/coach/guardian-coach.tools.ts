import type OpenAI from "openai";
import { AppError } from "../../../common/errors/AppError.js";
import { holidaysService } from "../../settings/holidays.service.js";
import { guardianAcademicsService } from "../academics/guardian-academics.service.js";
import { guardianStudentsService } from "../students/guardian-students.service.js";
import {
  queueStudentKnowledgeIngest,
  studentKnowledgeIngestService,
} from "../../coach/student-knowledge-ingest.service.js";

export type GuardianCoachSource = {
  kind: "database" | "document";
  label: string;
  detail?: string | null;
};

export type GuardianCoachToolResult = {
  data: unknown;
  sources: GuardianCoachSource[];
};

function normalizeName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function compactLesson(lesson: {
  sessionId: string;
  kind?: string;
  topic?: string;
  subject?: string | null;
  className?: string;
  room?: string | null;
  teacher?: string | null;
  startAt: string;
  endAt: string;
  assessmentId?: string;
  status?: string;
  homework?: { title: string; dueAt: string } | null;
}) {
  return {
    sessionId: lesson.sessionId,
    kind: lesson.kind ?? "class",
    title: lesson.topic || lesson.className || "Lesson",
    subject: lesson.subject ?? null,
    className: lesson.className ?? null,
    room: lesson.room ?? null,
    teacher: lesson.teacher ?? null,
    startAt: lesson.startAt,
    endAt: lesson.endAt,
    status: lesson.status ?? null,
    assessmentId: lesson.assessmentId ?? null,
    homework: lesson.homework
      ? { title: lesson.homework.title, dueAt: lesson.homework.dueAt }
      : null,
  };
}

/** Minimal live tools — most answers come from vectorized student knowledge. */
export const GUARDIAN_COACH_TOOL_DEFINITIONS: OpenAI.Chat.Completions.ChatCompletionTool[] =
  [
    {
      type: "function",
      function: {
        name: "resolveChild",
        description:
          "Resolve which linked child the parent means. Call first when studentId is unknown.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: {
              type: "string",
              description: "Child full/preferred/partial name",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "refreshStudentKnowledge",
        description:
          "Force re-index of the child's vectorized knowledge (enrollment, attendance, exams, homework, summary). Use if data seems stale.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            studentId: { type: "string" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getChildUpcoming",
        description:
          "Live upcoming timetable (today / this week / next week). Prefer this for 'what is today/this week'.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            studentId: { type: "string" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getHolidays",
        description: "School holidays. Optional YYYY-MM-DD range filter.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            startDate: { type: "string" },
            endDate: { type: "string" },
          },
        },
      },
    },
  ];

function parseArgs(argsJson: string): Record<string, unknown> {
  if (!argsJson?.trim()) return {};
  try {
    const parsed = JSON.parse(argsJson) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    throw new AppError(400, "Invalid tool arguments", "VALIDATION_ERROR");
  }
}

function requireStudentId(
  args: Record<string, unknown>,
  fallbackStudentId?: string | null,
) {
  const fromArgs = typeof args.studentId === "string" ? args.studentId : "";
  const studentId = fromArgs || fallbackStudentId || "";
  if (!studentId) {
    throw new AppError(400, "studentId is required", "VALIDATION_ERROR");
  }
  return studentId;
}

function mapChildren(
  data: Awaited<ReturnType<typeof guardianStudentsService.listForGuardian>>,
) {
  return data.students.map((student) => ({
    studentId: student.id,
    fullName: student.fullName,
    preferredName: student.preferredName,
    yearLevel: student.yearLevel,
    username: student.username,
    enrollments: student.enrollments.map((enrollment) => ({
      id: enrollment.id,
      status: enrollment.status,
      fee: enrollment.fee,
      term: enrollment.term?.name ?? null,
      subjects: enrollment.subjects.map((s) => s.name),
    })),
  }));
}

export type GuardianCoachToolContext = {
  focusedStudentId?: string | null;
  guardianUserId?: string;
};

export async function executeGuardianCoachTool(
  guardianUserId: string,
  name: string,
  argsJson: string,
  context: GuardianCoachToolContext = {},
): Promise<GuardianCoachToolResult> {
  const args = parseArgs(argsJson);
  const fallbackStudentId = context.focusedStudentId ?? null;

  switch (name) {
    case "resolveChild": {
      const data = await guardianStudentsService.listForGuardian(guardianUserId);
      const children = mapChildren(data);
      const query =
        typeof args.name === "string" ? normalizeName(args.name) : "";

      if (children.length === 0) {
        return {
          data: {
            status: "none",
            needsClarification: true,
            message: "No linked children found.",
            children: [],
          },
          sources: [{ kind: "database", label: "Resolve child", detail: "none" }],
        };
      }

      if (!query) {
        if (children.length === 1) {
          queueStudentKnowledgeIngest(
            () =>
              studentKnowledgeIngestService.ensureIndexed(children[0].studentId, {
                actorUserId: guardianUserId,
              }),
            "ensure-index-only-child",
          );
          return {
            data: {
              status: "resolved",
              needsClarification: false,
              studentId: children[0].studentId,
              child: children[0],
            },
            sources: [
              {
                kind: "database",
                label: "Resolved only child",
                detail: children[0].fullName,
              },
            ],
          };
        }
        return {
          data: {
            status: "ambiguous",
            needsClarification: true,
            message: "Ask which child they mean.",
            candidates: children.map((child) => ({
              studentId: child.studentId,
              fullName: child.fullName,
              preferredName: child.preferredName,
            })),
          },
          sources: [
            {
              kind: "database",
              label: "Ambiguous child",
              detail: `${children.length} children`,
            },
          ],
        };
      }

      const matches = children.filter((child) => {
        const full = normalizeName(child.fullName);
        const preferred = child.preferredName
          ? normalizeName(child.preferredName)
          : "";
        return (
          full === query ||
          preferred === query ||
          full.includes(query) ||
          (preferred && preferred.includes(query)) ||
          query.includes(full) ||
          (preferred && query.includes(preferred))
        );
      });

      if (matches.length === 1) {
        queueStudentKnowledgeIngest(
          () =>
            studentKnowledgeIngestService.ensureIndexed(matches[0].studentId, {
              actorUserId: guardianUserId,
            }),
          "ensure-index-named-child",
        );
        return {
          data: {
            status: "resolved",
            needsClarification: false,
            studentId: matches[0].studentId,
            child: matches[0],
          },
          sources: [
            {
              kind: "database",
              label: "Resolved child",
              detail: matches[0].fullName,
            },
          ],
        };
      }

      if (matches.length === 0 && children.length === 1) {
        queueStudentKnowledgeIngest(
          () =>
            studentKnowledgeIngestService.ensureIndexed(children[0].studentId, {
              actorUserId: guardianUserId,
            }),
          "ensure-index-fallback-child",
        );
        return {
          data: {
            status: "resolved",
            needsClarification: false,
            studentId: children[0].studentId,
            child: children[0],
            note: "Name did not match but only one child is linked.",
          },
          sources: [
            {
              kind: "database",
              label: "Fallback only child",
              detail: children[0].fullName,
            },
          ],
        };
      }

      return {
        data: {
          status: matches.length === 0 ? "not_found" : "ambiguous",
          needsClarification: true,
          message:
            matches.length === 0
              ? "No child matched that name."
              : "Multiple children matched.",
          candidates: (matches.length ? matches : children).map((child) => ({
            studentId: child.studentId,
            fullName: child.fullName,
            preferredName: child.preferredName,
          })),
        },
        sources: [
          {
            kind: "database",
            label: "Child clarification needed",
            detail: query,
          },
        ],
      };
    }

    case "refreshStudentKnowledge": {
      const studentId = requireStudentId(args, fallbackStudentId);
      await studentKnowledgeIngestService.ensureIndexed(studentId, {
        force: true,
        actorUserId: guardianUserId,
      });
      return {
        data: { refreshed: true, studentId },
        sources: [
          {
            kind: "database",
            label: "Knowledge re-indexed",
            detail: studentId,
          },
        ],
      };
    }

    case "getChildUpcoming": {
      const studentId = requireStudentId(args, fallbackStudentId);
      const data = await guardianAcademicsService.getUpcoming(
        guardianUserId,
        studentId,
      );
      return {
        data: {
          today: data.today.map(compactLesson),
          thisWeek: data.thisWeek.map(compactLesson),
          nextWeek: data.nextWeek.map(compactLesson),
        },
        sources: [
          {
            kind: "database",
            label: "Live upcoming schedule",
            detail: studentId,
          },
        ],
      };
    }

    case "getHolidays": {
      const startDate =
        typeof args.startDate === "string" ? args.startDate.slice(0, 10) : null;
      const endDate =
        typeof args.endDate === "string" ? args.endDate.slice(0, 10) : null;
      const holidays = await holidaysService.list();
      const filtered = holidays.filter((holiday) => {
        if (startDate && holiday.endDate < startDate) return false;
        if (endDate && holiday.startDate > endDate) return false;
        return true;
      });
      return {
        data: {
          holidays: filtered.map((holiday) => ({
            id: holiday.id,
            name: holiday.name,
            kind: holiday.kind,
            startDate: holiday.startDate,
            endDate: holiday.endDate,
            term: holiday.term?.name ?? null,
          })),
        },
        sources: [
          {
            kind: "database",
            label: "Holidays",
            detail: `${filtered.length} holiday(s)`,
          },
        ],
      };
    }

    default:
      throw new AppError(400, `Unknown tool: ${name}`, "VALIDATION_ERROR");
  }
}
