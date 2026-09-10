import type OpenAI from "openai";
import { UserRole } from "../../../common/constants/roles.js";
import { AppError } from "../../../common/errors/AppError.js";
import { adminAssessmentsService } from "../../admin/assessments/admin-assessments.service.js";
import { holidaysService } from "../../settings/holidays.service.js";
import { teacherClassService } from "../class/teacher-class.service.js";
import { teacherHomeworkService } from "../homework/teacher-homework.service.js";

export type TeacherCoachSource = {
  kind: "database" | "document";
  label: string;
  detail?: string | null;
};

export type TeacherCoachToolResult = {
  data: unknown;
  sources: TeacherCoachSource[];
};

export const TEACHER_COACH_TOOL_DEFINITIONS: OpenAI.Chat.Completions.ChatCompletionTool[] =
  [
    {
      type: "function",
      function: {
        name: "getTodayOverview",
        description:
          "Teacher dashboard for today: classes taught and today's sessions plus remaining week sessions.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "listUpcomingSessions",
        description:
          "Upcoming class/assessment sessions (today, this week, next week). Optional subject name filter. Do NOT use this for past/previous/ended classes.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            subject: {
              type: "string",
              description: "Optional subject name filter",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "listPastSessions",
        description:
          "Ended/past classes and assessments (newest first), with enrolled/attended/absent counts. Use for previous months, past classes, or historical schedule. Then call getSessionDetail for who was absent/present.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            subject: {
              type: "string",
              description: "Optional subject name filter",
            },
            page: {
              type: "integer",
              description: "Page number starting at 1 (default 1)",
            },
            limit: {
              type: "integer",
              description: "Page size, max 50 (default 20)",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getSessionDetail",
        description:
          "Full attendance for one session (including ended classes): present, absent, excused, exceptions, and notes with student names. Call after listPastSessions or listUpcomingSessions when you have a sessionId.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            sessionId: { type: "string" },
          },
          required: ["sessionId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "listHomework",
        description: "Homework the teacher created (recent / open items).",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            search: { type: "string" },
            subjectId: {
              type: "string",
              description: "Subject UUID or subject name",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getMarkingQueue",
        description:
          "Entrance/assessment marking queue: which assessments still need marks.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "listMySubjects",
        description: "Subjects this teacher teaches (from classes and assessments).",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {},
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

function toIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : String(value);
}

function compactSession(session: {
  id: string;
  subject?: string;
  className?: string | null;
  lesson?: string | null;
  room?: string | null;
  startAt: string | Date;
  endAt: string | Date;
  status?: string;
  kind?: string;
  enrolledCount?: number | null;
  attendedCount?: number | null;
  absentCount?: number | null;
}) {
  return {
    sessionId: session.id,
    kind: session.kind ?? "class",
    subject: session.subject ?? null,
    className: session.className ?? null,
    topic: session.lesson ?? null,
    room: session.room ?? null,
    startAt: toIso(session.startAt),
    endAt: toIso(session.endAt),
    status: session.status ?? null,
    enrolled: session.enrolledCount ?? null,
    attended: session.attendedCount ?? null,
    absent: session.absentCount ?? null,
  };
}

function compactRollRow(row: {
  id: string;
  fullName: string;
  status: string;
}) {
  return {
    studentId: row.id,
    name: row.fullName,
    status: row.status,
  };
}

export async function executeTeacherCoachTool(
  teacherUserId: string,
  name: string,
  argsJson: string,
): Promise<TeacherCoachToolResult> {
  const args = parseArgs(argsJson);

  switch (name) {
    case "getTodayOverview": {
      const data = await teacherClassService.getTeacherDashboardData(
        teacherUserId,
      );
      return {
        data: {
          classes: data.classes,
          today: data.activeSessions.map(compactSession),
          laterThisWeek: data.weekSessions.map(compactSession),
        },
        sources: [
          {
            kind: "database",
            label: "Today overview",
            detail: `${data.activeSessions.length} today`,
          },
        ],
      };
    }

    case "listUpcomingSessions": {
      const subject =
        typeof args.subject === "string" ? args.subject.trim() : undefined;
      const data = await teacherClassService.listUpcomingSessions(
        teacherUserId,
        { range: "initial", subject: subject || undefined },
      );
      if (data.range !== "initial") {
        return {
          data: { sessions: [] },
          sources: [
            {
              kind: "database",
              label: "Upcoming sessions",
              detail: subject || "all subjects",
            },
          ],
        };
      }
      return {
        data: {
          today: data.today.map(compactSession),
          thisWeek: data.thisWeek.map(compactSession),
          nextWeek: data.nextWeek.map(compactSession),
        },
        sources: [
          {
            kind: "database",
            label: "Upcoming sessions",
            detail: subject || "all subjects",
          },
        ],
      };
    }

    case "listPastSessions": {
      const subject =
        typeof args.subject === "string" ? args.subject.trim() : undefined;
      const page =
        typeof args.page === "number" && Number.isFinite(args.page)
          ? Math.max(1, Math.floor(args.page))
          : 1;
      const limit =
        typeof args.limit === "number" && Number.isFinite(args.limit)
          ? Math.min(50, Math.max(1, Math.floor(args.limit)))
          : 20;
      const data = await teacherClassService.listPastSessions(teacherUserId, {
        subject: subject || undefined,
        page,
        limit,
      });
      return {
        data: {
          page: data.page,
          total: data.total,
          hasMore: data.hasMore,
          sessions: data.sessions.map(compactSession),
        },
        sources: [
          {
            kind: "database",
            label: "Past sessions",
            detail: subject
              ? `${subject} · page ${data.page}`
              : `page ${data.page} · ${data.total} total`,
          },
        ],
      };
    }

    case "getSessionDetail": {
      const sessionId =
        typeof args.sessionId === "string" ? args.sessionId.trim() : "";
      if (!sessionId) {
        throw new AppError(400, "sessionId is required", "VALIDATION_ERROR");
      }
      const data = await teacherClassService.getSessionDetail(
        teacherUserId,
        sessionId,
      );
      return {
        data: {
          session: compactSession(data.session),
          summary: data.summary,
          attended: data.attended.slice(0, 40).map(compactRollRow),
          absent: data.absent.slice(0, 40).map(compactRollRow),
          excused: data.excused.slice(0, 20).map(compactRollRow),
          exceptions: data.exceptions.slice(0, 20).map(compactRollRow),
          notes: data.notes.slice(0, 20).map((note) => ({
            studentName: note.studentName,
            status: note.status,
            note: note.note,
          })),
        },
        sources: [
          {
            kind: "database",
            label: "Session attendance",
            detail: sessionId,
          },
        ],
      };
    }

    case "listHomework": {
      const search =
        typeof args.search === "string" ? args.search.trim() : undefined;
      const subjectId =
        typeof args.subjectId === "string" ? args.subjectId.trim() : undefined;
      const data = await teacherHomeworkService.list(
        teacherUserId,
        UserRole.STAFF,
        {
          page: 1,
          limit: 15,
          search,
          subjectId,
        },
      );
      return {
        data: {
          total: data.total,
          homework: data.homework.map((item) => ({
            id: item.id,
            title: item.title,
            subject: item.subject?.name ?? null,
            yearGroup: item.yearGroup,
            dueDate: item.dueDate,
            assignedCount: item.assignedCount,
            submittedCount: item.submittedCount,
            pendingCount: item.pendingCount,
          })),
        },
        sources: [
          {
            kind: "database",
            label: "Homework list",
            detail: `${data.total} item(s)`,
          },
        ],
      };
    }

    case "getMarkingQueue": {
      const data = await adminAssessmentsService.listMarkingQueue(teacherUserId);
      return {
        data: {
          needsMarking: data.needsMarking,
          items: data.items.slice(0, 20).map((item) => ({
            id: item.id,
            name: item.name,
            subject: item.subject,
            yearGroup: item.yearGroup,
            assessmentDate: item.assessmentDate,
            status: item.status,
            submitted: item.submittedCount,
            unmarked: item.unmarkedCount,
          })),
        },
        sources: [
          {
            kind: "database",
            label: "Marking queue",
            detail: `${data.needsMarking} need marking`,
          },
        ],
      };
    }

    case "listMySubjects": {
      const data = await teacherClassService.getTeacherSubjects(teacherUserId);
      return {
        data,
        sources: [
          {
            kind: "database",
            label: "My subjects",
            detail: `${data.subjects.length} subject(s)`,
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
