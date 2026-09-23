import { UserRole } from "../../../../common/constants/roles.js";
import type { AdminAiSource } from "../../../../entities/AdminAiMessage.js";
import type { AdminAiActor } from "../authorization.js";
import {
  disabledCapabilityMessage,
  isBulkRecipientAudience,
  isCapabilityEnabled,
  type AdminAiCapabilitySettings,
} from "../admin-ai-capabilities.js";
import { actionSource } from "../tool-helpers.js";
import { createCommunicationDraft } from "./communication.tools.js";
import {
  createAnnouncementDraft,
  resolveAnnouncementSeverity,
} from "../announcements/announcement.tools.js";

const FALLBACK_REPLY =
  "I've prepared the email. Review and finalize it in the preview below.";
const FALLBACK_ANNOUNCEMENT_REPLY =
  "I've prepared the announcement draft. Review and approve it in the preview below.";

/** Normalize common typos before intent checks. */
function normalizeCommText(raw: string) {
  return raw
    .toLowerCase()
    .replace(/\battendence\b/g, "attendance")
    .replace(/\biwnat\b/g, "want")
    .replace(/\bwana\b/g, "want")
    .replace(/\bmsg\b/g, "message")
    .replace(/\be-mails?\b/g, "email")
    .replace(/\byaer\b/g, "year")
    .replace(/\btommorw\b/g, "tomorrow")
    .replace(/\btmrw\b/g, "tomorrow")
    .replace(/\btmro\b/g, "tomorrow")
    .replace(/\bcraete\b/g, "create")
    .replace(/\bannoucement\b/g, "announcement")
    .replace(/\bannouce\b/g, "announce")
    .replace(/\s+/g, " ")
    .trim();
}

export function looksLikeAnnouncementIntent(raw: string): boolean {
  const t = normalizeCommText(raw);
  if (!t) return false;
  return /\b(announcement|announcements|notice|notices|broadcast|platform notice)\b/.test(t);
}

/**
 * Broad, typo-tolerant: user wants to email/message/notify someone.
 * Excludes clear report/PDF asks unless they also say email/message.
 */
export function looksLikeCommunicationIntent(raw: string): boolean {
  const t = normalizeCommText(raw);
  if (!t) return false;

  const asksReportOnly =
    /\b(pdf|export|download|report|generate\s+pdf)\b/.test(t) &&
    !/\b(email|message|notify|remind)\b/.test(t);
  if (asksReportOnly) return false;

  const asksDataOnly =
    /\b(show|list|how many|count|find|who is|who's)\b/.test(t) &&
    !/\b(email|message|notify|remind|send)\b/.test(t);
  if (asksDataOnly) return false;

  const hasVerb =
    /\b(email|message|notify|remind)\b/.test(t) ||
    /\bsend\b/.test(t) ||
    /\b(mail|text)\b/.test(t) ||
    /\b(announcement|announcements|notice|notices|broadcast|announce)\b/.test(t);

  const hasAudience =
    /\b(students?|parents?|guardians?|teachers?|staff|tutors?|class|year\s*\d+|everyone)\b/.test(
      t,
    ) || /\ball\b/.test(t);

  return hasVerb && hasAudience;
}

function hasConfirmSendAction(sources: AdminAiSource[]) {
  return sources.some(
    (source) => source.kind === "action" && Boolean(source.confirmSend?.draftId),
  );
}

function hasConfirmAnnouncementAction(sources: AdminAiSource[]) {
  return sources.some(
    (source) => source.kind === "action" && Boolean(source.confirmAnnouncement),
  );
}

function inferFallbackAudience(raw: string) {
  const t = normalizeCommText(raw);
  const wantsAll = /\b(all|everyone|everybody)\b/.test(t);
  const wantsParents = /\b(parents?|guardians?)\b/.test(t);
  const wantsStudents = /\bstudents?\b/.test(t);
  const wantsTeachers = /\b(teachers?|tutors?|staff)\b/.test(t);

  const yearMatch = t.match(/\byear\s*(\d{1,2})\b/);
  const yearLevel = yearMatch ? `${yearMatch[1]}` : undefined;
  const yearLabel = yearMatch ? `Year ${yearMatch[1]}` : "";

  if (wantsAll && !wantsParents && !wantsStudents && !wantsTeachers) {
    return {
      roles: ["ALL"],
      recipientOf: "SELF" as const,
      label: "All",
      ambiguous: false,
    };
  }

  if (wantsParents && !wantsStudents) {
    return {
      roles: [UserRole.STUDENT],
      yearLevel,
      recipientOf: "PARENTS" as const,
      label: yearLabel ? `${yearLabel} Parents` : "Parents / guardians",
      ambiguous: false,
    };
  }
  if (wantsTeachers && !wantsStudents && !wantsParents) {
    return {
      roles: [UserRole.STAFF],
      recipientOf: "SELF" as const,
      label: "Staff",
      ambiguous: false,
    };
  }
  // Default: students
  return {
    roles: [UserRole.STUDENT],
    yearLevel,
    recipientOf: "SELF" as const,
    label: yearLabel ? `${yearLabel} Students` : "All active students",
    ambiguous: false,
  };
}

function inferSubjectAndBody(raw: string) {
  const t = normalizeCommText(raw);
  const yearMatch = t.match(/\byear\s*(\d{1,2})\b/);
  const yearLabel = yearMatch ? `Year ${yearMatch[1]}` : "";

  if (/\b(no\s+class|no\s+classes|cancelled|canceled)\b/.test(t)) {
    const title = yearLabel ? `${yearLabel} Classes Cancelled` : "Classes Cancelled";
    const body = `Please be advised that all ${yearLabel ? `${yearLabel} ` : ""}classes have been cancelled for tomorrow. Regular classes will resume on the next scheduled school day.`;
    return { subject: title, body };
  }
  if (/\battendance\b/.test(t)) {
    return {
      subject: "Attendance reminder",
      body: "This is a reminder about attendance. Please review and stay up to date.",
    };
  }
  if (/\bhomework\b/.test(t)) {
    return {
      subject: "Homework reminder",
      body: "This is a reminder regarding upcoming homework submissions. Please submit all pending work on time.",
    };
  }
  return {
    subject: yearLabel ? `${yearLabel} Notice` : "Platform Announcement",
    body: raw.trim(),
  };
}

/**
 * If the user asked to email/message or announce to someone but the model skipped
 * the draft tool, create the draft server-side and attach the confirm action.
 */
export async function ensureCommunicationPreviewIfNeeded(input: {
  actor: AdminAiActor;
  userMessage: string;
  threadId: string | null;
  sources: AdminAiSource[];
  settings: AdminAiCapabilitySettings;
  replyText: string;
  actionCommand?: string | null;
}): Promise<{
  sources: AdminAiSource[];
  replyText: string;
  ensured: boolean;
}> {
  const { actor, userMessage, threadId, settings, actionCommand } = input;
  let { sources, replyText } = input;

  if (hasConfirmSendAction(sources) || hasConfirmAnnouncementAction(sources)) {
    return { sources, replyText, ensured: false };
  }

  const cmd = String(actionCommand ?? "")
    .trim()
    .toLowerCase();
  const forceEmergency = cmd === "emergency";
  const forceAnnouncement =
    cmd === "announcement" || cmd === "bulk-message" || forceEmergency;
  const forceEmail = cmd === "email" || cmd === "bulk-email";

  // Slash commands are authoritative — do not depend on fuzzy intent heuristics.
  if (
    !forceAnnouncement &&
    !forceEmail &&
    !looksLikeCommunicationIntent(userMessage)
  ) {
    return { sources, replyText, ensured: false };
  }
  if (!isCapabilityEnabled(settings, "confirmedActions")) {
    return { sources, replyText, ensured: false };
  }

  const isAnnouncement =
    forceAnnouncement ||
    (!forceEmail && looksLikeAnnouncementIntent(userMessage));

  if (isAnnouncement) {
    if (!isCapabilityEnabled(settings, "messageDrafting")) {
      return { sources, replyText, ensured: false };
    }
    try {
      const audience = inferFallbackAudience(userMessage);
      const { subject, body } = inferSubjectAndBody(userMessage);
      const severity = resolveAnnouncementSeverity(undefined, actionCommand);
      const result = await createAnnouncementDraft(actor, {
        title:
          subject ||
          (forceEmergency ? "Emergency Alert" : "Platform Announcement"),
        message: body || userMessage,
        roles: audience.roles ?? (forceAnnouncement ? ["ALL"] : undefined),
        recipientOf: audience.recipientOf,
        label: audience.label,
        ambiguous: audience.ambiguous,
        severity,
        actionCommand,
        userMessage,
        threadId: threadId ?? undefined,
      });

      const nextSources = [
        ...sources,
        ...result.sources,
        ...(result.actions ?? []).map((action) => actionSource(action)),
      ];

      return {
        sources: nextSources,
        replyText: forceEmergency
          ? "I've prepared the emergency alert draft. Review and approve it in the preview below."
          : FALLBACK_ANNOUNCEMENT_REPLY,
        ensured: true,
      };
    } catch {
      return { sources, replyText, ensured: false };
    }
  }

  if (!isCapabilityEnabled(settings, "emailDrafting")) {
    return { sources, replyText, ensured: false };
  }

  const audience = inferFallbackAudience(userMessage);
  const { subject, body } = inferSubjectAndBody(userMessage);

  try {
    const result = await createCommunicationDraft(actor, {
      subject,
      body,
      roles: audience.roles,
      recipientOf: audience.recipientOf,
      label: audience.label,
      ambiguous: audience.ambiguous,
      userMessage,
      threadId: threadId ?? undefined,
    });

    const data = result.data as { error?: unknown; recipientCount?: unknown };
    if (typeof data.error === "string" && data.error) {
      return {
        sources,
        replyText: data.error,
        ensured: false,
      };
    }

    const recipientCount =
      typeof data.recipientCount === "number" ? data.recipientCount : 0;
    if (
      isBulkRecipientAudience(recipientCount) &&
      !isCapabilityEnabled(settings, "bulkCommunication")
    ) {
      return {
        sources,
        replyText: disabledCapabilityMessage("bulkCommunication"),
        ensured: false,
      };
    }

    const nextSources = [
      ...sources,
      ...result.sources,
      ...(result.actions ?? []).map((action) => actionSource(action)),
    ];

    return {
      sources: nextSources,
      replyText: FALLBACK_REPLY,
      ensured: true,
    };
  } catch {
    return { sources, replyText, ensured: false };
  }
}
