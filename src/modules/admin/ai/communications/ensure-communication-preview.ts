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

const FALLBACK_REPLY =
  "I've prepared the email. Review and finalize it in the preview below.";

/** Normalize common typos before intent checks. */
function normalizeCommText(raw: string) {
  return raw
    .toLowerCase()
    .replace(/\battendence\b/g, "attendance")
    .replace(/\biwnat\b/g, "want")
    .replace(/\bwana\b/g, "want")
    .replace(/\bmsg\b/g, "message")
    .replace(/\be-mails?\b/g, "email")
    .replace(/\s+/g, " ")
    .trim();
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
    /\b(mail|text)\b/.test(t);

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

function inferFallbackAudience(raw: string) {
  const t = normalizeCommText(raw);
  const wantsParents = /\b(parents?|guardians?)\b/.test(t);
  const wantsStudents = /\bstudents?\b/.test(t);
  const wantsTeachers = /\b(teachers?|tutors?|staff)\b/.test(t);

  if (wantsParents && !wantsStudents) {
    return {
      roles: [UserRole.STUDENT],
      recipientOf: "PARENTS" as const,
      label: "Parents / guardians",
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
  // Default: students (covers "all student", "message to students", etc.)
  return {
    roles: [UserRole.STUDENT],
    recipientOf: "SELF" as const,
    label: "All active students",
    ambiguous: false,
  };
}

function inferSubjectAndBody(raw: string) {
  const t = normalizeCommText(raw);
  if (/\battendance\b/.test(t)) {
    return {
      subject: "Attendance reminder",
      body: "This is a reminder about attendance. Please review and stay up to date.",
    };
  }
  if (/\bhomework\b/.test(t)) {
    return {
      subject: "Homework reminder",
      body: "",
    };
  }
  return { subject: "", body: "" };
}

/**
 * If the user asked to email/message someone but the model skipped
 * createCommunicationDraft, create the draft server-side and attach CONFIRM_SEND.
 */
export async function ensureCommunicationPreviewIfNeeded(input: {
  actor: AdminAiActor;
  userMessage: string;
  threadId: string | null;
  sources: AdminAiSource[];
  settings: AdminAiCapabilitySettings;
  replyText: string;
}): Promise<{
  sources: AdminAiSource[];
  replyText: string;
  ensured: boolean;
}> {
  const { actor, userMessage, threadId, settings } = input;
  let { sources, replyText } = input;

  if (hasConfirmSendAction(sources)) {
    return { sources, replyText, ensured: false };
  }
  if (!looksLikeCommunicationIntent(userMessage)) {
    return { sources, replyText, ensured: false };
  }
  if (!isCapabilityEnabled(settings, "emailDrafting")) {
    return { sources, replyText, ensured: false };
  }
  if (!isCapabilityEnabled(settings, "confirmedActions")) {
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
