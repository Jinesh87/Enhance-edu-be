import type { AdminAiActor } from "../authorization.js";
import {
  disabledCapabilityMessage,
  isBulkRecipientAudience,
  isCapabilityEnabled,
  loadAdminAiCapabilitySettings,
} from "../admin-ai-capabilities.js";
import { sanitizeToolPayload } from "../sanitize.js";
import {
  confirmSendCommunicationAction,
  type ToolResult,
} from "../tool-helpers.js";
import { suggestAmbiguityOptions } from "./audience.normalize.js";
import { communicationDraftService } from "./communication-draft.service.js";

function draftToolResult(
  draft: Awaited<ReturnType<typeof communicationDraftService.create>>,
  hintExtra?: string,
): ToolResult {
  const needsAudience = Boolean(draft.requiresAudienceConfirm);
  const empty = Boolean(draft.emptyReason);
  return {
    data: sanitizeToolPayload({
      draftId: draft.draftId,
      channel: draft.channel,
      subject: draft.subject,
      body: draft.body,
      audience: draft.audience,
      audienceLabel: draft.audienceLabel,
      recipientCount: draft.recipientCount,
      sendableCount: draft.sendableCount,
      missingEmailCount: draft.missingEmailCount,
      emptyReason: draft.emptyReason,
      requiresReauth: draft.requiresReauth,
      requiresAudienceConfirm: needsAudience,
      audienceOptions: draft.audienceOptions,
      status: draft.status,
      attachments: draft.attachments,
      responseHint: [
        "Email DRAFT prepared — nothing has been sent.",
        "Reply briefly: I've prepared the email. Do NOT ask for subject or body in chat — the Email Preview UI collects them.",
        "Do NOT ask the admin to confirm in chat. The UI Confirm Send button sends.",
        needsAudience
          ? "Audience is ambiguous — ask them to pick an option in the preview UI."
          : empty
            ? `Preview shows: ${draft.emptyReason}`
            : `Preview To: ${draft.audienceLabel}.`,
        draft.subject?.trim()
          ? `Suggested subject (editable in UI): ${draft.subject}`
          : "Subject may be empty — admin fills it in the preview.",
        draft.body?.trim()
          ? "Message body is pre-filled and editable in the preview."
          : "Message may be empty — admin fills it in the preview.",
        "Never show raw email addresses or phone numbers.",
        draft.requiresReauth
          ? "Bulk send will require password re-auth on Confirm Send."
          : "",
        "Never claim the email was sent.",
        hintExtra ?? "",
      ]
        .filter(Boolean)
        .join(" "),
    }),
    sources: [
      {
        kind: "draft",
        label: "Communication draft",
        detail: draft.audienceLabel,
      },
    ],
    actions: [confirmSendCommunicationAction(draft.draftId, "Confirm Send")],
  };
}

async function rejectIfBulkDisabled(
  actor: AdminAiActor,
  draft: Awaited<ReturnType<typeof communicationDraftService.create>>,
  options?: { discard?: boolean },
): Promise<ToolResult | null> {
  if (!isBulkRecipientAudience(draft.recipientCount)) return null;
  const settings = await loadAdminAiCapabilitySettings();
  if (isCapabilityEnabled(settings, "bulkCommunication")) return null;
  if (options?.discard) {
    await communicationDraftService.discard(actor, draft.draftId).catch(() => {
      /* best-effort cleanup */
    });
  }
  return {
    data: sanitizeToolPayload({
      error: disabledCapabilityMessage("bulkCommunication"),
      recipientCount: draft.recipientCount,
      audienceLabel: draft.audienceLabel,
      responseHint:
        "Bulk Communication is disabled in Settings → AI. Enable it there, or message a single recipient.",
    }),
    sources: [],
  };
}

function parseUserIds(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) {
    return raw
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 500);
  }
  if (typeof raw === "string" && raw.trim()) {
    return raw
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 500);
  }
  return undefined;
}

function parseStringList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

/** Create email draft + resolve audience snapshot. Does NOT send. */
export async function createCommunicationDraft(
  actor: AdminAiActor,
  args: {
    subject?: string;
    body?: string;
    /** @deprecated Prefer roles/groups filters. */
    audienceType?: string;
    roles?: unknown;
    groups?: unknown;
    yearLevel?: string;
    term?: string;
    subjectFilter?: string;
    className?: string;
    date?: string;
    nameQuery?: string;
    userIds?: unknown;
    recipientOf?: string;
    assessmentQuery?: string;
    enquiryStage?: string;
    status?: string;
    label?: string;
    ambiguous?: boolean;
    userMessage?: string;
    threadId?: string;
  },
): Promise<ToolResult> {
  const suggested =
    args.ambiguous || (!args.roles && !args.groups && !args.audienceType)
      ? suggestAmbiguityOptions(args.userMessage)
      : null;

  const draft = await communicationDraftService.create(actor, {
    subject: args.subject,
    body: args.body,
    audience: {
      type: args.audienceType,
      roles: parseStringList(args.roles) ?? suggested?.[0]?.roles,
      groups: parseStringList(args.groups) ?? suggested?.[0]?.groups,
      yearLevel: args.yearLevel,
      term: args.term,
      subject: args.subjectFilter,
      className: args.className,
      date: args.date,
      nameQuery: args.nameQuery,
      userIds: parseUserIds(args.userIds),
      recipientOf:
        args.recipientOf ?? suggested?.[0]?.recipientOf ?? "SELF",
      assessmentQuery: args.assessmentQuery,
      enquiryStage: args.enquiryStage,
      status: args.status,
      label: args.label,
      ambiguous: Boolean(args.ambiguous) || Boolean(suggested?.length),
      confirmed: false,
      options: suggested,
    },
    threadId: args.threadId ?? null,
  });
  const rejected = await rejectIfBulkDisabled(actor, draft, { discard: true });
  if (rejected) return rejected;
  return draftToolResult(draft);
}

export async function updateCommunicationDraft(
  actor: AdminAiActor,
  args: {
    draftId?: string;
    subject?: string;
    body?: string;
    audienceType?: string;
    roles?: unknown;
    groups?: unknown;
    yearLevel?: string;
    term?: string;
    subjectFilter?: string;
    className?: string;
    date?: string;
    nameQuery?: string;
    userIds?: unknown;
    recipientOf?: string;
    assessmentQuery?: string;
    enquiryStage?: string;
    status?: string;
    label?: string;
    ambiguous?: boolean;
    confirmed?: boolean;
    refreshAudience?: boolean;
  },
): Promise<ToolResult> {
  if (!args.draftId?.trim()) {
    return {
      data: sanitizeToolPayload({
        error: "No communication draft to update.",
        responseHint: "Create a draft first.",
      }),
      sources: [],
    };
  }

  const hasAudiencePatch = Boolean(
    args.audienceType ||
      args.roles ||
      args.groups ||
      args.recipientOf ||
      args.confirmed !== undefined ||
      args.yearLevel ||
      args.term ||
      args.subjectFilter ||
      args.className ||
      args.date ||
      args.nameQuery ||
      args.userIds ||
      args.assessmentQuery ||
      args.enquiryStage ||
      args.status ||
      args.label,
  );

  const draft = await communicationDraftService.update(actor, args.draftId, {
    subject: args.subject,
    body: args.body,
    audience: hasAudiencePatch
      ? {
          type: args.audienceType,
          roles: parseStringList(args.roles),
          groups: parseStringList(args.groups),
          yearLevel: args.yearLevel,
          term: args.term,
          subject: args.subjectFilter,
          className: args.className,
          date: args.date,
          nameQuery: args.nameQuery,
          userIds: parseUserIds(args.userIds),
          recipientOf: args.recipientOf,
          assessmentQuery: args.assessmentQuery,
          enquiryStage: args.enquiryStage,
          status: args.status,
          label: args.label,
          ambiguous: args.ambiguous,
          confirmed: args.confirmed,
          options: null,
        }
      : undefined,
    refreshAudience: args.refreshAudience,
  });
  const rejected = await rejectIfBulkDisabled(actor, draft);
  if (rejected) return rejected;
  return draftToolResult(draft, "Draft updated. Still not sent.");
}

export async function previewAudience(
  actor: AdminAiActor,
  args: { draftId?: string },
): Promise<ToolResult> {
  if (!args.draftId?.trim()) {
    return {
      data: sanitizeToolPayload({
        error: "No draft id for audience preview.",
      }),
      sources: [],
    };
  }
  const draft = await communicationDraftService.previewAudience(
    actor,
    args.draftId,
  );
  return draftToolResult(draft, "Audience refreshed from live data.");
}

export async function getCommunicationDraft(
  actor: AdminAiActor,
  args: { draftId?: string },
): Promise<ToolResult> {
  if (!args.draftId?.trim()) {
    return {
      data: sanitizeToolPayload({
        error: "No draft id provided.",
      }),
      sources: [],
    };
  }
  const draft = await communicationDraftService.get(actor, args.draftId);
  return draftToolResult(draft);
}
