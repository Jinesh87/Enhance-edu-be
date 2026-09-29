import { In, IsNull } from "typeorm";
import { AppDataSource } from "../../config/data-source.js";
import { logger } from "../../config/logger.js";
import { AppError } from "../../common/errors/AppError.js";
import {
  calendarDateInTimeZone,
  formatInTimeZone,
  isValidTimeZone,
  zonedWallTimeToUtc,
} from "../../common/utils/timezone.js";
import {
  ACTIVE_MEETING_STATUSES,
  GoogleCalendarConnection,
  GuardianStudent,
  MeetingRequest,
  User,
  type MeetingRequestStatus,
} from "../../entities/index.js";
import type { NotificationType } from "../../entities/Notification.js";
import { notifyUsers } from "../notifications/domain-notifications.js";
import type { CreateNotificationInput } from "../notifications/notifications.service.js";
import { settingsService, type MeetingSettings } from "../settings/settings.service.js";
import { listSuperAdmins, listTeachersForGuardian } from "../shared/chat/chat-auth.js";
import { googleCalendarConfigService } from "../integrations/google/google-calendar-config.service.js";
import {
  createMeetEvent,
  deleteCalendarEvent,
  getCalendarBusy,
  type BusyInterval,
} from "../integrations/google/google-calendar-api.js";

export const MEETING_DURATIONS = [15, 30, 45, 60] as const;
const SLOT_STEP_MINUTES = 30;
/** Guardians can't book a slot that starts sooner than this. */
const MIN_LEAD_MINUTES = 60;
const MAX_DAYS_AHEAD = 60;

const HREF = {
  guardian: "/guardian/meetings",
  teacher: "/tutor/meetings",
  admin: "/admin/meeting-requests",
};

export type MeetingDisplayStatus = MeetingRequestStatus | "EXPIRED";

export type MeetingRequestDto = {
  id: string;
  status: MeetingRequestStatus;
  displayStatus: MeetingDisplayStatus;
  startAt: string;
  endAt: string;
  timeZone: string;
  topic: string;
  note: string | null;
  guardian: { id: string; name: string; email: string | null };
  teacher: { id: string; name: string; email: string | null };
  student: { id: string; name: string; yearLevel: number | null } | null;
  /** Classes the teacher takes for the student (or any of the guardian's children when no student is set). */
  classes?: MeetingClassContext[];
  adminNote: string | null;
  adminReviewedAt: string | null;
  teacherNote: string | null;
  teacherRespondedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: "GUARDIAN" | "TEACHER" | null;
  meetLink: string | null;
  calendarEventLink: string | null;
  createdAt: string;
};

export type MeetingClassContext = {
  studentName: string;
  className: string;
  subject: string | null;
  term: string | null;
  academicYear: string | null;
  yearLevel: string | null;
};

export type CreateMeetingInput = {
  teacherId: string;
  studentId?: string | null;
  startAt: string;
  durationMinutes: number;
  timeZone?: string | null;
  topic: string;
  note?: string | null;
};

function repo() {
  return AppDataSource.getRepository(MeetingRequest);
}

function displayName(user: Pick<User, "fullName" | "preferredName"> | null | undefined) {
  if (!user) return "Unknown";
  return user.preferredName?.trim() || user.fullName;
}

/** The requester's browser time zone, falling back to the zone saved with the meeting hours. */
function requestTimeZone(raw: string | null | undefined, settings: Pick<MeetingSettings, "timeZone">) {
  const tz = raw?.trim();
  return tz && isValidTimeZone(tz) ? tz : settings.timeZone;
}

/** Midnight-to-midnight for a calendar date (YYYY-MM-DD) in the given time zone. */
function localDayRange(date: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    start: zonedWallTimeToUtc({ year, month, day, hour: 0, minute: 0 }, timeZone),
    end: zonedWallTimeToUtc(
      { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate(), hour: 0, minute: 0 },
      timeZone,
    ),
  };
}

/** The admin's bookable window on a calendar date (YYYY-MM-DD) in the admin's meeting time zone. */
function meetingWindow(date: string, settings: Pick<MeetingSettings, "dayStart" | "dayEnd" | "timeZone">) {
  const [year, month, day] = date.split("-").map(Number);
  const at = (hhmm: string) => {
    const [hour, minute] = hhmm.split(":").map(Number);
    return zonedWallTimeToUtc({ year, month, day, hour, minute }, settings.timeZone);
  };
  return { windowStart: at(settings.dayStart), windowEnd: at(settings.dayEnd) };
}

function overlaps(aStart: Date, aEnd: Date, b: BusyInterval) {
  return aStart < b.end && aEnd > b.start;
}

function whenLabel(request: Pick<MeetingRequest, "startAt" | "timeZone">) {
  return formatInTimeZone(request.startAt, request.timeZone, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function toDto(row: MeetingRequest): MeetingRequestDto {
  const pending = row.status === "PENDING_ADMIN" || row.status === "PENDING_TEACHER";
  return {
    id: row.id,
    status: row.status,
    displayStatus: pending && row.startAt.getTime() <= Date.now() ? "EXPIRED" : row.status,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    timeZone: row.timeZone,
    topic: row.topic,
    note: row.note,
    guardian: {
      id: row.guardianUserId,
      name: displayName(row.guardian),
      email: row.guardian?.email ?? null,
    },
    teacher: { id: row.teacherUserId, name: displayName(row.teacher), email: row.teacher?.email ?? null },
    student: row.student
      ? { id: row.student.id, name: row.student.fullName, yearLevel: row.student.yearLevel }
      : null,
    adminNote: row.adminNote,
    adminReviewedAt: row.adminReviewedAt?.toISOString() ?? null,
    teacherNote: row.teacherNote,
    teacherRespondedAt: row.teacherRespondedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelledBy: !row.cancelledById
      ? null
      : row.cancelledById === row.teacherUserId
        ? "TEACHER"
        : "GUARDIAN",
    meetLink: row.meetLink,
    calendarEventLink: row.status === "SCHEDULED" ? row.calendarEventLink : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Classes the meeting's teacher takes for the meeting's student (or for any of the guardian's
 * children when no student was chosen), correlated to the meeting row aliased `m`.
 */
const CLASS_CONTEXT_SQL = `
  SELECT
    COALESCE(NULLIF(st."preferredName", ''), st."fullName") AS "studentName",
    c.name AS "className",
    c.subject AS "subject",
    COALESCE(t.name, c."termName") AS "term",
    ay."displayName" AS "academicYear",
    COALESCE(yl.name, CASE WHEN st."yearLevel" IS NOT NULL THEN 'Year ' || st."yearLevel" END) AS "yearLevel"
  FROM students st
  INNER JOIN class_students cs ON cs."studentId" = st."userId"
  INNER JOIN classes c ON c.id = cs."classId"
    AND (c."teacherId" = m."teacherUserId" OR EXISTS (
      SELECT 1 FROM sessions s WHERE s."classId" = c.id AND s."teacherId" = m."teacherUserId"
    ))
  LEFT JOIN terms t ON t.id = c."termId"
  LEFT JOIN academic_years ay ON ay.id = t."academicYearId"
  LEFT JOIN year_levels yl ON yl.id = t."yearLevelId"
  WHERE st.id = m."studentId"
    OR (m."studentId" IS NULL AND st.id IN (
      SELECT gs."studentId" FROM guardian_students gs WHERE gs."guardianId" = m."guardianUserId"
    ))
`;

export type AdminMeetingListInput = {
  view: "pending" | "all";
  status?: MeetingRequestStatus;
  academicYear?: string;
  term?: string;
  page: number;
  limit: number;
};

async function classContexts(meetingIds: string[]): Promise<Map<string, MeetingClassContext[]>> {
  const result = new Map<string, MeetingClassContext[]>();
  if (meetingIds.length === 0) return result;
  const rows: Array<MeetingClassContext & { meetingId: string }> = await AppDataSource.query(
    `
    SELECT DISTINCT m.id AS "meetingId", x.*
    FROM meeting_requests m
    CROSS JOIN LATERAL (${CLASS_CONTEXT_SQL}) x
    WHERE m.id = ANY($1::uuid[])
    ORDER BY x."studentName", x."className"
    `,
    [meetingIds],
  );
  for (const { meetingId, ...context } of rows) {
    const list = result.get(meetingId) ?? [];
    list.push(context);
    result.set(meetingId, list);
  }
  return result;
}

function payload(
  type: NotificationType,
  title: string,
  body: string,
  href: string,
  meetingId: string,
): Omit<CreateNotificationInput, "userId"> {
  return { type, title, body, data: { meetingId, href } };
}

async function connectedUserIds(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await AppDataSource.getRepository(GoogleCalendarConnection).find({
    where: { userId: In(userIds) },
    select: { userId: true },
  });
  return new Set(rows.map((r) => r.userId));
}

class MeetingsService {
  private async loadRequest(id: string) {
    const row = await repo().findOne({
      where: { id },
      relations: { guardian: true, teacher: true, student: true },
    });
    if (!row) throw new AppError(404, "Meeting request not found", "MEETING_NOT_FOUND");
    return row;
  }

  private async eligibleTeacher(guardianUserId: string, teacherUserId: string) {
    const teachers = await listTeachersForGuardian(guardianUserId);
    const teacher = teachers.find((t) => t.userId === teacherUserId);
    if (!teacher) {
      throw new AppError(403, "You can only request meetings with your child's teachers.", "MEETING_TEACHER_NOT_ALLOWED");
    }
    const connected = await connectedUserIds([teacherUserId]);
    if (!connected.has(teacherUserId)) {
      throw new AppError(
        409,
        "This teacher hasn't connected Google Calendar yet, so meetings can't be booked with them.",
        "GOOGLE_CALENDAR_NOT_CONNECTED",
      );
    }
    return teacher;
  }

  private async assertCalendarAvailable() {
    if (!(await googleCalendarConfigService.getCredentials())) {
      throw new AppError(
        409,
        "Google Calendar meetings aren't turned on for this institution.",
        "GOOGLE_CALENDAR_UNAVAILABLE",
      );
    }
  }

  /** Google Calendar busy blocks, the teacher's classes, and other open meeting requests. */
  private async teacherBusy(
    teacherUserId: string,
    from: Date,
    to: Date,
    excludeRequestId?: string,
  ): Promise<BusyInterval[]> {
    const [googleBusy, sessionRows, meetingRows] = await Promise.all([
      getCalendarBusy(teacherUserId, from, to),
      AppDataSource.query(
        `
        SELECT s."startAt", s."endAt"
        FROM sessions s
        LEFT JOIN classes c ON c.id = s."classId"
        WHERE (s."teacherId" = $1 OR (s."teacherId" IS NULL AND c."teacherId" = $1))
          AND s."startAt" < $3
          AND s."endAt" > $2
        `,
        [teacherUserId, from, to],
      ) as Promise<Array<{ startAt: Date; endAt: Date }>>,
      repo()
        .createQueryBuilder("m")
        .select(["m.id", "m.startAt", "m.endAt"])
        .where("m.teacherUserId = :teacherUserId", { teacherUserId })
        .andWhere("m.status IN (:...statuses)", { statuses: ACTIVE_MEETING_STATUSES })
        .andWhere("m.startAt < :to AND m.endAt > :from", { from, to })
        .getMany(),
    ]);

    return [
      ...googleBusy,
      ...sessionRows.map((s) => ({ start: new Date(s.startAt), end: new Date(s.endAt) })),
      ...meetingRows
        .filter((m) => m.id !== excludeRequestId)
        .map((m) => ({ start: m.startAt, end: m.endAt })),
    ];
  }

  // ---------------------------------------------------------------- guardian

  async guardianOptions(guardianUserId: string) {
    const [credentials, meetingSettings, teachers, links] = await Promise.all([
      googleCalendarConfigService.getCredentials(),
      settingsService.getMeetingSettings(),
      listTeachersForGuardian(guardianUserId),
      AppDataSource.getRepository(GuardianStudent).find({
        where: { guardianId: guardianUserId },
        relations: { student: true },
      }),
    ]);
    const connected = await connectedUserIds(teachers.map((t) => t.userId));
    return {
      available: Boolean(credentials),
      adminApprovalRequired: meetingSettings.adminApprovalRequired,
      dayStart: meetingSettings.dayStart,
      dayEnd: meetingSettings.dayEnd,
      timeZone: meetingSettings.timeZone,
      durations: MEETING_DURATIONS,
      teachers: teachers.map((t) => ({
        id: t.userId,
        name: t.preferredName?.trim() || t.fullName,
        classes: [...new Set(t.sharedClasses.map((c) => c.className.trim()).filter(Boolean))],
        calendarConnected: connected.has(t.userId),
      })),
      students: links
        .filter((l) => l.student)
        .map((l) => ({ id: l.studentId, name: l.student.fullName })),
    };
  }

  async availability(
    guardianUserId: string,
    input: { teacherId: string; date: string; durationMinutes: number; timeZone?: string | null },
  ) {
    await this.assertCalendarAvailable();
    await this.eligibleTeacher(guardianUserId, input.teacherId);

    const settings = await settingsService.getMeetingSettings();
    const guardianTimeZone = requestTimeZone(input.timeZone, settings);

    // The guardian's local day, intersected with the admin's bookable hours on every
    // admin-calendar date that day touches (a local day can span two admin dates).
    const { start: dayStart, end: dayEnd } = localDayRange(input.date, guardianTimeZone);
    const adminDates = new Set([
      calendarDateInTimeZone(dayStart, settings.timeZone),
      calendarDateInTimeZone(new Date(dayEnd.getTime() - 1), settings.timeZone),
    ]);
    const windows = [...adminDates]
      .map((date) => meetingWindow(date, settings))
      .filter((w) => w.windowStart < dayEnd && w.windowEnd > dayStart);

    const earliest = Date.now() + MIN_LEAD_MINUTES * 60_000;
    const latest = Date.now() + MAX_DAYS_AHEAD * 86_400_000;
    const empty = { date: input.date, timeZone: guardianTimeZone, adminTimeZone: settings.timeZone, slots: [] };
    if (windows.length === 0) return empty;

    const rangeStart = new Date(Math.min(...windows.map((w) => w.windowStart.getTime())));
    const rangeEnd = new Date(Math.max(...windows.map((w) => w.windowEnd.getTime())));
    if (rangeEnd.getTime() <= earliest || rangeStart.getTime() > latest) return empty;

    const busy = await this.teacherBusy(input.teacherId, rangeStart, rangeEnd);
    const durationMs = input.durationMinutes * 60_000;
    const slots: Array<{ startAt: string; endAt: string }> = [];
    for (const { windowStart, windowEnd } of windows) {
      for (
        let t = windowStart.getTime();
        t + durationMs <= windowEnd.getTime();
        t += SLOT_STEP_MINUTES * 60_000
      ) {
        if (t < earliest || t < dayStart.getTime() || t >= dayEnd.getTime()) continue;
        const start = new Date(t);
        const end = new Date(t + durationMs);
        if (busy.some((b) => overlaps(start, end, b))) continue;
        slots.push({ startAt: start.toISOString(), endAt: end.toISOString() });
      }
    }
    slots.sort((a, b) => a.startAt.localeCompare(b.startAt));
    return { ...empty, slots };
  }

  async listForGuardian(guardianUserId: string) {
    const rows = await repo().find({
      where: { guardianUserId },
      relations: { guardian: true, teacher: true, student: true },
      order: { startAt: "DESC" },
      take: 200,
    });
    return rows.map(toDto);
  }

  async create(guardianUserId: string, input: CreateMeetingInput) {
    await this.assertCalendarAvailable();
    await this.eligibleTeacher(guardianUserId, input.teacherId);

    if (input.studentId) {
      const link = await AppDataSource.getRepository(GuardianStudent).findOne({
        where: { guardianId: guardianUserId, studentId: input.studentId },
      });
      if (!link) throw new AppError(404, "Student not found", "STUDENT_NOT_FOUND");
    }

    const startAt = new Date(input.startAt);
    const endAt = new Date(startAt.getTime() + input.durationMinutes * 60_000);
    if (startAt.getTime() < Date.now() + MIN_LEAD_MINUTES * 60_000) {
      throw new AppError(400, "Pick a time at least an hour from now.", "MEETING_TOO_SOON");
    }
    if (startAt.getTime() > Date.now() + MAX_DAYS_AHEAD * 86_400_000) {
      throw new AppError(400, `Meetings can be booked up to ${MAX_DAYS_AHEAD} days ahead.`, "MEETING_TOO_FAR");
    }

    const settings = await settingsService.getMeetingSettings();
    const timeZone = requestTimeZone(input.timeZone, settings);
    const { windowStart, windowEnd } = meetingWindow(
      calendarDateInTimeZone(startAt, settings.timeZone),
      settings,
    );
    if (startAt < windowStart || endAt > windowEnd) {
      throw new AppError(
        400,
        `Meetings can only be booked between ${settings.dayStart} and ${settings.dayEnd} (${settings.timeZone} time).`,
        "MEETING_OUTSIDE_HOURS",
      );
    }

    const busy = await this.teacherBusy(input.teacherId, startAt, endAt);
    if (busy.some((b) => overlaps(startAt, endAt, b))) {
      throw new AppError(409, "That time is no longer free on the teacher's calendar. Pick another slot.", "MEETING_SLOT_UNAVAILABLE");
    }

    const adminApprovalRequired = settings.adminApprovalRequired;
    const saved = await repo().save(
      repo().create({
        guardianUserId,
        teacherUserId: input.teacherId,
        studentId: input.studentId ?? null,
        startAt,
        endAt,
        timeZone,
        topic: input.topic.trim(),
        note: input.note?.trim() || null,
        status: adminApprovalRequired ? "PENDING_ADMIN" : "PENDING_TEACHER",
        sentToTeacherAt: adminApprovalRequired ? null : new Date(),
      }),
    );
    const request = await this.loadRequest(saved.id);
    const guardianName = displayName(request.guardian);
    const about = request.student ? ` about ${request.student.fullName}` : "";

    if (adminApprovalRequired) {
      const admins = await listSuperAdmins();
      await notifyUsers(
        admins.map((a) => ({
          userId: a.userId,
          ...payload(
            "MEETING_REQUESTED",
            "Meeting request needs approval",
            `${guardianName} wants to meet ${displayName(request.teacher)}${about} · ${whenLabel(request)}`,
            HREF.admin,
            request.id,
          ),
        })),
      );
    } else {
      await this.notifyTeacherOfRequest(request);
    }

    return toDto(request);
  }

  private async notifyTeacherOfRequest(request: MeetingRequest) {
    const about = request.student ? ` about ${request.student.fullName}` : "";
    await notifyUsers([
      {
        userId: request.teacherUserId,
        ...payload(
          "MEETING_REQUESTED",
          "New meeting request",
          `${displayName(request.guardian)} requested a Google Meet${about} · ${whenLabel(request)}`,
          HREF.teacher,
          request.id,
        ),
      },
    ]);
  }

  // ------------------------------------------------------------------ admin

  async listForAdmin(input: AdminMeetingListInput) {
    const base = (view: AdminMeetingListInput["view"]) => {
      const qb = repo().createQueryBuilder("m");
      if (view === "pending") {
        qb.where(`m.status = 'PENDING_ADMIN'`).andWhere(`m."startAt" > now()`);
      } else if (input.status) {
        qb.where("m.status = :status", { status: input.status });
      }
      if (input.academicYear || input.term) {
        qb.andWhere(
          `EXISTS (
            SELECT 1 FROM (${CLASS_CONTEXT_SQL}) x
            WHERE (CAST(:academicYear AS text) IS NULL OR x."academicYear" = :academicYear)
              AND (CAST(:term AS text) IS NULL OR x."term" = :term)
          )`,
          { academicYear: input.academicYear || null, term: input.term || null },
        );
      }
      return qb;
    };

    const listQuery = base(input.view)
      .leftJoinAndSelect("m.guardian", "guardian")
      .leftJoinAndSelect("m.teacher", "teacher")
      .leftJoinAndSelect("m.student", "student")
      .orderBy(input.view === "pending" ? "m.startAt" : "m.createdAt", input.view === "pending" ? "ASC" : "DESC")
      .skip((input.page - 1) * input.limit)
      .take(input.limit);

    const [[rows, total], pendingCount, allCount, filterRows] = await Promise.all([
      listQuery.getManyAndCount(),
      base("pending").getCount(),
      base("all").getCount(),
      AppDataSource.query(
        `
        SELECT DISTINCT x."academicYear", x."term"
        FROM meeting_requests m
        CROSS JOIN LATERAL (${CLASS_CONTEXT_SQL}) x
        WHERE x."academicYear" IS NOT NULL OR x."term" IS NOT NULL
        `,
      ) as Promise<Array<{ academicYear: string | null; term: string | null }>>,
    ]);

    const classes = await classContexts(rows.map((r) => r.id));
    return {
      items: rows.map((row) => ({ ...toDto(row), classes: classes.get(row.id) ?? [] })),
      total,
      page: input.page,
      limit: input.limit,
      totalPages: Math.max(1, Math.ceil(total / input.limit)),
      counts: { pending: pendingCount, all: allCount },
      filterOptions: filterRows,
    };
  }

  async adminDecide(adminUserId: string, id: string, input: { approve: boolean; note?: string | null }) {
    const request = await this.loadRequest(id);
    if (request.status !== "PENDING_ADMIN") {
      throw new AppError(409, "This request has already been reviewed.", "MEETING_ALREADY_REVIEWED");
    }
    if (input.approve && request.startAt.getTime() <= Date.now()) {
      throw new AppError(409, "The requested time has already passed.", "MEETING_EXPIRED");
    }

    const now = new Date();
    const claimed = await repo()
      .createQueryBuilder()
      .update(MeetingRequest)
      .set({
        status: input.approve ? "PENDING_TEACHER" : "REJECTED",
        adminReviewedById: adminUserId,
        adminReviewedAt: now,
        adminNote: input.note?.trim() || null,
        sentToTeacherAt: input.approve ? now : null,
      })
      .where("id = :id AND status = :status", { id, status: "PENDING_ADMIN" })
      .execute();
    if (!claimed.affected) {
      throw new AppError(409, "This request has already been reviewed.", "MEETING_ALREADY_REVIEWED");
    }

    const updated = await this.loadRequest(id);
    if (input.approve) {
      await this.notifyTeacherOfRequest(updated);
      await notifyUsers([
        {
          userId: updated.guardianUserId,
          ...payload(
            "MEETING_UPDATED",
            "Meeting request approved by the school",
            `Your request with ${displayName(updated.teacher)} was sent to the teacher · ${whenLabel(updated)}`,
            HREF.guardian,
            updated.id,
          ),
        },
      ]);
    } else {
      await notifyUsers([
        {
          userId: updated.guardianUserId,
          ...payload(
            "MEETING_UPDATED",
            "Meeting request not approved",
            updated.adminNote
              ? `The school declined your meeting with ${displayName(updated.teacher)}: ${updated.adminNote}`
              : `The school declined your meeting with ${displayName(updated.teacher)}.`,
            HREF.guardian,
            updated.id,
          ),
        },
      ]);
    }
    return toDto(updated);
  }

  // ---------------------------------------------------------------- teacher

  async listForTeacher(teacherUserId: string) {
    const rows = await repo()
      .createQueryBuilder("m")
      .leftJoinAndSelect("m.guardian", "guardian")
      .leftJoinAndSelect("m.teacher", "teacher")
      .leftJoinAndSelect("m.student", "student")
      .where("m.teacherUserId = :teacherUserId", { teacherUserId })
      .andWhere("m.sentToTeacherAt IS NOT NULL")
      .orderBy("m.startAt", "DESC")
      .take(200)
      .getMany();
    const classes = await classContexts(rows.map((r) => r.id));
    return rows.map((row) => ({ ...toDto(row), classes: classes.get(row.id) ?? [] }));
  }

  async teacherDecide(teacherUserId: string, id: string, input: { approve: boolean; note?: string | null }) {
    const request = await this.loadRequest(id);
    if (request.teacherUserId !== teacherUserId) {
      throw new AppError(404, "Meeting request not found", "MEETING_NOT_FOUND");
    }
    if (request.status !== "PENDING_TEACHER") {
      throw new AppError(409, "This request is no longer waiting for you.", "MEETING_NOT_PENDING");
    }
    if (input.approve && request.startAt.getTime() <= Date.now()) {
      throw new AppError(409, "The requested time has already passed.", "MEETING_EXPIRED");
    }
    const note = input.note?.trim() || null;

    if (!input.approve) {
      const result = await repo().update(
        { id, status: "PENDING_TEACHER", teacherRespondedAt: IsNull() },
        { status: "DECLINED", teacherRespondedAt: new Date(), teacherNote: note },
      );
      if (!result.affected) {
        throw new AppError(409, "This request is no longer waiting for you.", "MEETING_NOT_PENDING");
      }
      const updated = await this.loadRequest(id);
      await notifyUsers([
        {
          userId: updated.guardianUserId,
          ...payload(
            "MEETING_UPDATED",
            "Meeting request declined",
            note
              ? `${displayName(updated.teacher)} can't meet at ${whenLabel(updated)}: ${note}`
              : `${displayName(updated.teacher)} can't meet at ${whenLabel(updated)}. Try another time.`,
            HREF.guardian,
            updated.id,
          ),
        },
      ]);
      return toDto(updated);
    }

    // Claim the request so a double-click can't book two events.
    const claim = await repo()
      .createQueryBuilder()
      .update(MeetingRequest)
      .set({ teacherRespondedAt: new Date() })
      .where('id = :id AND status = :status AND "teacherRespondedAt" IS NULL', {
        id,
        status: "PENDING_TEACHER",
      })
      .execute();
    if (!claim.affected) {
      throw new AppError(409, "This request is already being processed.", "MEETING_NOT_PENDING");
    }

    try {
      const busy = await this.teacherBusy(teacherUserId, request.startAt, request.endAt, request.id);
      if (busy.some((b) => overlaps(request.startAt, request.endAt, b))) {
        throw new AppError(
          409,
          "Your calendar now has something else at this time. Decline and ask the guardian to pick another slot.",
          "MEETING_SLOT_UNAVAILABLE",
        );
      }

      const guardianConnection = await AppDataSource.getRepository(GoogleCalendarConnection).findOne({
        where: { userId: request.guardianUserId },
      });
      const guardianEmail = guardianConnection?.googleEmail || request.guardian?.email || null;
      const studentLine = request.student ? `Student: ${request.student.fullName}\n` : "";
      const event = await createMeetEvent({
        organizerUserId: teacherUserId,
        summary: `Parent–teacher meeting: ${request.topic}`,
        description:
          `${studentLine}Guardian: ${displayName(request.guardian)}\nTeacher: ${displayName(request.teacher)}` +
          (request.note ? `\n\nNote from guardian:\n${request.note}` : "") +
          (note ? `\n\nNote from teacher:\n${note}` : ""),
        startAt: request.startAt,
        endAt: request.endAt,
        timeZone: request.timeZone,
        attendeeEmails: guardianEmail ? [guardianEmail] : [],
        requestId: request.id,
      });

      await repo().update(
        { id },
        {
          status: "SCHEDULED",
          teacherNote: note,
          googleEventId: event.eventId,
          meetLink: event.meetLink,
          calendarEventLink: event.htmlLink,
        },
      );
    } catch (error) {
      await repo().update({ id, status: "PENDING_TEACHER" }, { teacherRespondedAt: null });
      throw error;
    }

    const updated = await this.loadRequest(id);
    await notifyUsers([
      {
        userId: updated.guardianUserId,
        ...payload(
          "MEETING_SCHEDULED",
          "Meeting confirmed",
          `${displayName(updated.teacher)} accepted · ${whenLabel(updated)}. Your Google Meet link is ready.`,
          HREF.guardian,
          updated.id,
        ),
      },
    ]);
    return toDto(updated);
  }

  // ------------------------------------------------------------ cancellation

  async cancel(
    actor: { id: string; role: "GUARDIAN" | "TEACHER" },
    id: string,
    reason?: string | null,
  ) {
    const request = await this.loadRequest(id);
    const isOwner =
      actor.role === "GUARDIAN"
        ? request.guardianUserId === actor.id
        : request.teacherUserId === actor.id && request.sentToTeacherAt !== null;
    if (!isOwner) throw new AppError(404, "Meeting request not found", "MEETING_NOT_FOUND");

    const cancellable: MeetingRequestStatus[] =
      actor.role === "GUARDIAN" ? ACTIVE_MEETING_STATUSES : ["SCHEDULED"];
    if (!cancellable.includes(request.status)) {
      throw new AppError(409, "This meeting can't be cancelled.", "MEETING_NOT_CANCELLABLE");
    }
    if (request.status === "SCHEDULED" && request.endAt.getTime() <= Date.now()) {
      throw new AppError(409, "This meeting has already finished.", "MEETING_NOT_CANCELLABLE");
    }

    const result = await repo().update(
      { id, status: request.status },
      { status: "CANCELLED", cancelledById: actor.id, cancelledAt: new Date() },
    );
    if (!result.affected) {
      throw new AppError(409, "This meeting changed in the meantime. Refresh and try again.", "MEETING_NOT_CANCELLABLE");
    }

    if (request.googleEventId) {
      await deleteCalendarEvent(request.teacherUserId, request.googleEventId).catch((error) => {
        logger.warn({ err: error, meetingId: id }, "Failed to remove cancelled meeting from Google Calendar");
      });
    }

    const updated = await this.loadRequest(id);
    const reasonText = reason?.trim() ? `: ${reason.trim()}` : ".";
    if (actor.role === "GUARDIAN") {
      if (request.sentToTeacherAt) {
        await notifyUsers([
          {
            userId: updated.teacherUserId,
            ...payload(
              "MEETING_CANCELLED",
              "Meeting cancelled",
              `${displayName(updated.guardian)} cancelled the meeting on ${whenLabel(updated)}${reasonText}`,
              HREF.teacher,
              updated.id,
            ),
          },
        ]);
      }
    } else {
      await notifyUsers([
        {
          userId: updated.guardianUserId,
          ...payload(
            "MEETING_CANCELLED",
            "Meeting cancelled",
            `${displayName(updated.teacher)} cancelled the meeting on ${whenLabel(updated)}${reasonText}`,
            HREF.guardian,
            updated.id,
          ),
        },
      ]);
    }
    return toDto(updated);
  }
}

export const meetingsService = new MeetingsService();
