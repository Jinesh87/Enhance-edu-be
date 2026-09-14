import type { AdminAiActor } from "../authorization.js";
import { sanitizeToolPayload } from "../sanitize.js";
import {
  confirmAnnouncementAction,
  type ToolResult,
} from "../tool-helpers.js";
import { suggestAmbiguityOptions } from "../communications/audience.normalize.js";
import { announcementService } from "./announcement.service.js";

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

/** Create announcement/notice draft + resolve audience count. Does NOT publish. */
export async function createAnnouncementDraft(
  actor: AdminAiActor,
  args: {
    title?: string;
    message?: string;
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

  const draft = await announcementService.previewDraft(actor, {
    title: args.title,
    message: args.message,
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
      recipientOf: args.recipientOf ?? suggested?.[0]?.recipientOf ?? "SELF",
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

  const needsAudience = Boolean(draft.requiresAudienceConfirm);

  return {
    data: sanitizeToolPayload({
      title: draft.title,
      message: draft.message,
      audience: draft.audience,
      audienceLabel: draft.audienceLabel,
      recipientCount: draft.recipientCount,
      recipients: draft.recipients,
      deliveryChannel: draft.deliveryChannel,
      requiresAudienceConfirm: needsAudience,
      audienceOptions: draft.audienceOptions,
      responseHint: [
        "Announcement / Notice DRAFT prepared — nothing has been published.",
        "Reply briefly: I've prepared the announcement draft. The preview UI allows the Admin to edit and Approve & Publish.",
        "Do NOT ask the admin to confirm in chat. The UI Approve & Publish button publishes.",
        needsAudience
          ? "Audience is ambiguous — ask them to select an audience option in the preview."
          : `Preview To: ${draft.audienceLabel} (${draft.recipientCount} recipients).`,
        draft.title?.trim()
          ? `Suggested Title (editable in UI): ${draft.title}`
          : "Title may be empty — admin can provide/edit it in the preview.",
        draft.message?.trim()
          ? "Message content is pre-filled and editable in the preview."
          : "Message may be empty — admin can fill it in the preview.",
        "Delivery channel is IN_APP only.",
        "Never claim the announcement was published.",
      ]
        .filter(Boolean)
        .join(" "),
    }),
    sources: [
      {
        kind: "draft",
        label: "Announcement draft",
        detail: `${draft.audienceLabel} (${draft.recipientCount} recipients)`,
      },
    ],
    actions: [
      confirmAnnouncementAction(
        {
          title: draft.title,
          message: draft.message,
          audience: draft.audience,
          audienceLabel: draft.audienceLabel,
          recipientCount: draft.recipientCount,
          deliveryChannel: "IN_APP",
          requiresAudienceConfirm: draft.requiresAudienceConfirm,
          audienceOptions: draft.audienceOptions,
        },
        "Approve & Publish",
      ),
    ],
  };
}
