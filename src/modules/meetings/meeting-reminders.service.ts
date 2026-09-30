import { AppDataSource } from "../../config/data-source.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { formatInTimeZone } from "../../common/utils/timezone.js";
import { MeetingRequest, ReminderDispatch, type User } from "../../entities/index.js";
import { emailService } from "../email/email.service.js";
import { notifyUsers } from "../notifications/domain-notifications.js";

const DAY_BEFORE_KIND = "MEETING_REMINDER_24H";
const SOON_KIND = "MEETING_REMINDER_15M";
const OUTCOME_KIND = "MEETING_OUTCOME_PROMPT";

const HOUR_MS = 60 * 60_000;
const SOON_MS = 15 * 60_000;
/** Skip the day-before reminder when the meeting was confirmed less than this long ago. */
const RECENTLY_CONFIRMED_MS = HOUR_MS;
/** Ask the teacher for an outcome this long after the meeting ends, for up to three days. */
const OUTCOME_DELAY_MS = 10 * 60_000;
const OUTCOME_WINDOW_MS = 3 * 24 * HOUR_MS;

const HREF = { guardian: "/guardian/meetings", teacher: "/tutor/meetings" };

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const withCode = error as { code?: unknown; driverError?: { code?: unknown } };
  return String(withCode.code ?? withCode.driverError?.code ?? "") === "23505";
}

async function claimDispatch(dispatchKey: string, kind: string): Promise<boolean> {
  try {
    await AppDataSource.getRepository(ReminderDispatch).insert({ dispatchKey, kind });
    return true;
  } catch (error) {
    if (!isUniqueViolation(error)) logger.warn({ err: error, dispatchKey }, "Meeting reminder claim failed");
    return false;
  }
}

function displayName(user: Pick<User, "fullName" | "preferredName"> | null | undefined) {
  if (!user) return "Unknown";
  return user.preferredName?.trim() || user.fullName;
}

function whenLabel(meeting: MeetingRequest) {
  return formatInTimeZone(meeting.startAt, meeting.timeZone, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function lastConfirmedAt(meeting: MeetingRequest) {
  const stamps = [meeting.teacherRespondedAt, meeting.guardianRespondedAt, meeting.rescheduledAt]
    .filter((d): d is Date => d instanceof Date)
    .map((d) => d.getTime());
  return stamps.length > 0 ? Math.max(...stamps) : meeting.createdAt.getTime();
}

function scheduledBetween(from: Date, to: Date, column: "startAt" | "endAt" = "startAt") {
  return AppDataSource.getRepository(MeetingRequest)
    .createQueryBuilder("m")
    .leftJoinAndSelect("m.guardian", "guardian")
    .leftJoinAndSelect("m.teacher", "teacher")
    .leftJoinAndSelect("m.student", "student")
    .where("m.status = 'SCHEDULED'")
    .andWhere(`m."${column}" > :from AND m."${column}" <= :to`, { from, to })
    .orderBy(`m.${column}`, "ASC")
    .take(500);
}

export class MeetingRemindersService {
  /** Day-before and starting-soon reminders for both sides, plus an outcome prompt for the teacher. */
  async runScan(): Promise<{ scanned: number; sent: number }> {
    const [dayBefore, soon, outcome] = await Promise.all([
      this.runDayBefore(),
      this.runStartingSoon(),
      this.runOutcomePrompts(),
    ]);
    return {
      scanned: dayBefore.scanned + soon.scanned + outcome.scanned,
      sent: dayBefore.sent + soon.sent + outcome.sent,
    };
  }

  private async runDayBefore() {
    const now = Date.now();
    const meetings = await scheduledBetween(new Date(now + SOON_MS), new Date(now + 24 * HOUR_MS)).getMany();
    let sent = 0;
    for (const meeting of meetings) {
      if (now - lastConfirmedAt(meeting) < RECENTLY_CONFIRMED_MS) continue;
      const claimed = await claimDispatch(
        `meeting-24h:${meeting.id}:${meeting.startAt.toISOString()}`,
        DAY_BEFORE_KIND,
      );
      if (!claimed) continue;
      try {
        await this.sendDayBefore(meeting);
        sent += 1;
      } catch (error) {
        logger.warn({ err: error, meetingId: meeting.id }, "Meeting day-before reminder failed");
      }
    }
    return { scanned: meetings.length, sent };
  }

  private async sendDayBefore(meeting: MeetingRequest) {
    const when = whenLabel(meeting);
    const teacherName = displayName(meeting.teacher);
    const guardianName = displayName(meeting.guardian);
    await notifyUsers([
      {
        userId: meeting.guardianUserId,
        type: "MEETING_REMINDER",
        title: "Upcoming meeting",
        body: `Your Google Meet with ${teacherName} is on ${when}.`,
        data: { meetingId: meeting.id, href: HREF.guardian },
      },
      {
        userId: meeting.teacherUserId,
        type: "MEETING_REMINDER",
        title: "Upcoming meeting",
        body: `Your Google Meet with ${guardianName} is on ${when}.`,
        data: { meetingId: meeting.id, href: HREF.teacher },
      },
    ]);

    const recipients = [
      { user: meeting.guardian, withName: teacherName, href: HREF.guardian },
      { user: meeting.teacher, withName: guardianName, href: HREF.teacher },
    ];
    for (const { user, withName, href } of recipients) {
      const email = user?.email?.trim();
      if (!user || !email) continue;
      await emailService.sendMeetingReminderEmail({
        to: email,
        fullName: user.fullName,
        withName,
        topic: meeting.topic,
        whenLabel: when,
        studentName: meeting.student?.fullName ?? null,
        meetLink: meeting.meetLink,
        meetingsLink: `${env.FRONTEND_URL}${href}`,
      });
    }
  }

  private async runStartingSoon() {
    const now = Date.now();
    const meetings = await scheduledBetween(new Date(now), new Date(now + SOON_MS)).getMany();
    let sent = 0;
    for (const meeting of meetings) {
      const claimed = await claimDispatch(
        `meeting-15m:${meeting.id}:${meeting.startAt.toISOString()}`,
        SOON_KIND,
      );
      if (!claimed) continue;
      const minutes = Math.max(1, Math.round((meeting.startAt.getTime() - now) / 60_000));
      const title = `Meeting starts in ${minutes} min`;
      await notifyUsers([
        {
          userId: meeting.guardianUserId,
          type: "MEETING_REMINDER",
          title,
          body: `Your Google Meet with ${displayName(meeting.teacher)} · ${meeting.topic}`,
          data: { meetingId: meeting.id, href: HREF.guardian, meetLink: meeting.meetLink },
        },
        {
          userId: meeting.teacherUserId,
          type: "MEETING_REMINDER",
          title,
          body: `Your Google Meet with ${displayName(meeting.guardian)} · ${meeting.topic}`,
          data: { meetingId: meeting.id, href: HREF.teacher, meetLink: meeting.meetLink },
        },
      ]);
      sent += 1;
    }
    return { scanned: meetings.length, sent };
  }

  private async runOutcomePrompts() {
    const now = Date.now();
    const meetings = await scheduledBetween(
      new Date(now - OUTCOME_WINDOW_MS),
      new Date(now - OUTCOME_DELAY_MS),
      "endAt",
    )
      .andWhere("m.outcome IS NULL")
      .getMany();
    let sent = 0;
    for (const meeting of meetings) {
      const claimed = await claimDispatch(`meeting-outcome:${meeting.id}`, OUTCOME_KIND);
      if (!claimed) continue;
      await notifyUsers([
        {
          userId: meeting.teacherUserId,
          type: "MEETING_REMINDER",
          title: "How did the meeting go?",
          body: `Record the outcome of your meeting with ${displayName(meeting.guardian)} (${whenLabel(meeting)}) and share notes with them.`,
          data: { meetingId: meeting.id, href: HREF.teacher },
        },
      ]);
      sent += 1;
    }
    return { scanned: meetings.length, sent };
  }
}

export const meetingRemindersService = new MeetingRemindersService();
