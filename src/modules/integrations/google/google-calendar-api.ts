import crypto from "crypto";
import { logger } from "../../../config/logger.js";
import { AppError } from "../../../common/errors/AppError.js";
import { googleCalendarConnectionService } from "./google-calendar-connection.service.js";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export type BusyInterval = { start: Date; end: Date };

export type CreatedMeetEvent = {
  eventId: string;
  meetLink: string | null;
  htmlLink: string | null;
};

type GoogleEvent = {
  id?: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: {
    createRequest?: { status?: { statusCode?: string } };
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
};

async function requireToken(userId: string) {
  const token = await googleCalendarConnectionService.getAccessToken(userId);
  if (!token) {
    throw new AppError(
      409,
      "The teacher's Google Calendar isn't connected, so the meeting can't be booked.",
      "GOOGLE_CALENDAR_NOT_CONNECTED",
    );
  }
  return token;
}

async function calendarFetch<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; body: T | null }> {
  const response = await fetch(`${CALENDAR_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = response.status === 204 ? null : ((await response.json().catch(() => null)) as T | null);
  return { ok: response.ok, status: response.status, body };
}

function meetLinkOf(event: GoogleEvent | null) {
  if (!event) return null;
  if (event.hangoutLink) return event.hangoutLink;
  const video = event.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video");
  return video?.uri ?? null;
}

/** Busy blocks on the user's connected calendar between `from` and `to`. */
export async function getCalendarBusy(userId: string, from: Date, to: Date): Promise<BusyInterval[]> {
  const { accessToken, calendarId } = await requireToken(userId);
  const result = await calendarFetch<{
    calendars?: Record<string, { busy?: Array<{ start: string; end: string }>; errors?: unknown[] }>;
  }>(accessToken, "/freeBusy", {
    method: "POST",
    body: JSON.stringify({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      items: [{ id: calendarId }],
    }),
  });

  const calendar = result.body?.calendars?.[calendarId];
  if (!result.ok || !calendar || calendar.errors?.length) {
    logger.warn({ userId, status: result.status, errors: calendar?.errors }, "Google freeBusy failed");
    throw new AppError(
      502,
      "Couldn't read the teacher's Google Calendar right now. Please try again shortly.",
      "GOOGLE_FREEBUSY_FAILED",
    );
  }

  return (calendar.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
}

/** Creates an event with a Google Meet link on the organiser's calendar and invites the attendees. */
export async function createMeetEvent(input: {
  organizerUserId: string;
  summary: string;
  description: string;
  startAt: Date;
  endAt: Date;
  timeZone: string;
  attendeeEmails: string[];
  requestId: string;
}): Promise<CreatedMeetEvent> {
  const { accessToken, calendarId } = await requireToken(input.organizerUserId);
  const calendarPath = `/calendars/${encodeURIComponent(calendarId)}/events`;

  const created = await calendarFetch<GoogleEvent>(
    accessToken,
    `${calendarPath}?conferenceDataVersion=1&sendUpdates=all`,
    {
      method: "POST",
      body: JSON.stringify({
        summary: input.summary,
        description: input.description,
        start: { dateTime: input.startAt.toISOString(), timeZone: input.timeZone },
        end: { dateTime: input.endAt.toISOString(), timeZone: input.timeZone },
        attendees: [...new Set(input.attendeeEmails.filter(Boolean))].map((email) => ({ email })),
        conferenceData: {
          createRequest: {
            requestId: `${input.requestId}-${crypto.randomUUID().slice(0, 8)}`,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
        reminders: { useDefault: true },
      }),
    },
  );

  if (!created.ok || !created.body?.id) {
    logger.warn({ status: created.status, body: created.body }, "Google event creation failed");
    throw new AppError(
      502,
      "Google Calendar didn't accept the meeting. Please try again.",
      "GOOGLE_EVENT_CREATE_FAILED",
    );
  }

  let event: GoogleEvent = created.body;
  if (!meetLinkOf(event) && event.conferenceData?.createRequest?.status?.statusCode === "pending") {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const refreshed = await calendarFetch<GoogleEvent>(
      accessToken,
      `${calendarPath}/${encodeURIComponent(created.body.id)}`,
    );
    if (refreshed.ok && refreshed.body) event = refreshed.body;
  }

  return {
    eventId: created.body.id,
    meetLink: meetLinkOf(event),
    htmlLink: event.htmlLink ?? null,
  };
}

/** Removes the event and emails attendees that it was cancelled. Missing events are ignored. */
export async function deleteCalendarEvent(organizerUserId: string, eventId: string): Promise<void> {
  const token = await googleCalendarConnectionService.getAccessToken(organizerUserId);
  if (!token) return;
  const result = await calendarFetch<unknown>(
    token.accessToken,
    `/calendars/${encodeURIComponent(token.calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    { method: "DELETE" },
  );
  if (!result.ok && result.status !== 404 && result.status !== 410) {
    logger.warn({ organizerUserId, eventId, status: result.status }, "Google event delete failed");
  }
}
