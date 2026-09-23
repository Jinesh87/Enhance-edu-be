import { UserRole } from "../../common/constants/roles.js";

export type ClassNotifyUrgency = "urgent" | "advance";

export type ClassNotifyChannels = {
  inApp: boolean;
  push: boolean;
  email: boolean;
  sms: boolean;
};

export type ClassNotifyScenario =
  | "reminder_1h"
  | "reminder_digest"
  | "term_schedule"
  | "session_updated"
  | "session_deleted";

export function resolveClassScheduleHref(
  role: string | null | undefined,
  _sessionId?: string | null,
): string {
  if (role === UserRole.GUARDIAN) {
    return "/guardian/students";
  }
  if (role === UserRole.STUDENT) {
    return "/student/classes?tab=timetable";
  }
  if (role === UserRole.STAFF) {
    return "/tutor/classes?tab=timetable";
  }
  return "/admin/classes/calendar";
}

const URGENT_HOURS = 4;

export function hoursUntilStart(startAt: Date, now: Date = new Date()): number {
  return (startAt.getTime() - now.getTime()) / (1000 * 60 * 60);
}

export function resolveSessionChangeUrgency(
  startAt: Date,
  now: Date = new Date(),
): ClassNotifyUrgency {
  return hoursUntilStart(startAt, now) < URGENT_HOURS ? "urgent" : "advance";
}

export function resolveClassNotifyChannels(params: {
  scenario: ClassNotifyScenario;
  urgency?: ClassNotifyUrgency;
  sessionChangeEmailEnabled: boolean;
  urgentCancelSmsEnabled: boolean;
  termScheduleEmailEnabled?: boolean;
}): ClassNotifyChannels {
  const { scenario } = params;

  if (scenario === "reminder_1h") {
    return { inApp: true, push: true, email: false, sms: false };
  }

  if (scenario === "reminder_digest") {
    return { inApp: false, push: false, email: true, sms: false };
  }

  if (scenario === "term_schedule") {
    const enabled = params.termScheduleEmailEnabled !== false;
    return {
      inApp: enabled,
      push: enabled,
      email: enabled,
      sms: false,
    };
  }

  const urgent = params.urgency === "urgent";
  return {
    inApp: true,
    push: true,
    email: urgent || params.sessionChangeEmailEnabled,
    sms: urgent && params.urgentCancelSmsEnabled,
  };
}
