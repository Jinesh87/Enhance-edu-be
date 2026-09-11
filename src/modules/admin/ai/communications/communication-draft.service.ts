import { randomUUID } from "crypto";
import { AppDataSource } from "../../../../config/data-source.js";
import { AppError } from "../../../../common/errors/AppError.js";
import { UserRole } from "../../../../common/constants/roles.js";
import { verifyPassword } from "../../../../common/utils/password.js";
import {
  AdminAiCommunicationDraft,
  type CommunicationAttachmentRef,
  type CommunicationAudience,
  type CommunicationRecipientSnapshot,
} from "../../../../entities/AdminAiCommunicationDraft.js";
import { User } from "../../../../entities/User.js";
import { writeAdminAiAudit } from "../audit.js";
import type { AdminAiActor } from "../authorization.js";
import { peopleRoleLabel } from "../query-normalize/normalize-tool-args.js";
import { audienceResolverService } from "./audience.resolver.js";
import {
  audienceHasTarget,
  defaultAudienceStatus,
  describeAudience,
  expandLegacyType,
  normalizeGroup,
  normalizeRole,
} from "./audience.normalize.js";
import {
  recipientHasEmail,
  sanitizeRecipientsForStorage,
} from "./audience.privacy.js";
import {
  assertWithinHardCap,
  BULK_ABSOLUTE_MAX_RECIPIENTS,
  BULK_REAUTH_THRESHOLD,
  expectedTypeConfirmPhrase,
  requiresTypeConfirm,
} from "../bulk-actions/bulk-action-limits.js";
import {
  enqueueBulkActionJob,
  storeBulkActionAttachments,
} from "../../../../common/queues/bulk-actions-queue.js";

export const COMM_DRAFT_TTL_MS = 30 * 60 * 1000;
export const COMM_BULK_REAUTH_THRESHOLD = BULK_REAUTH_THRESHOLD;

function asTrimmedString(value: unknown, max = 80): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : null;
}

function sanitizeUserIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const item of raw.slice(0, 500)) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id,
      )
    ) {
      out.push(id);
    }
  }
  return out.length ? out : null;
}

function sanitizeStringList(
  raw: unknown,
  normalize: (value: string) => string | null,
  max = 8,
): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const item of raw.slice(0, max)) {
    if (typeof item !== "string") continue;
    const normalized = normalize(item);
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out.length ? out : null;
}

function sanitizeAudience(
  raw: Record<string, unknown> | null | undefined,
): CommunicationAudience {
  const legacy = expandLegacyType(asTrimmedString(raw?.type, 64));

  let roles =
    sanitizeStringList(raw?.roles, normalizeRole) ?? legacy?.roles ?? null;
  let groups =
    sanitizeStringList(raw?.groups, (value) => normalizeGroup(value)) ??
    legacy?.groups ??
    null;

  const recipientRaw = String(
    raw?.recipientOf ?? legacy?.recipientOf ?? "SELF",
  )
    .trim()
    .toUpperCase();
  const recipientOf =
    recipientRaw === "PARENTS" ? ("PARENTS" as const) : ("SELF" as const);

  if (recipientOf === "PARENTS") {
    const onlyGuardian =
      roles?.length &&
      roles.every((role) => role.toUpperCase() === UserRole.GUARDIAN);
    if (!roles?.length || onlyGuardian) {
      roles = [UserRole.STUDENT];
    }
  }

  const optionsRaw = Array.isArray(raw?.options) ? raw.options : null;
  const options =
    optionsRaw
      ?.map((item) => {
        if (!item || typeof item !== "object") return null;
        const row = item as Record<string, unknown>;
        const label = asTrimmedString(row.label, 120);
        if (!label) return null;
        const legacyOption = expandLegacyType(asTrimmedString(row.type, 64));
        const optionRecipient = String(
          row.recipientOf ?? legacyOption?.recipientOf ?? "SELF",
        )
          .trim()
          .toUpperCase();
        return {
          label,
          roles:
            sanitizeStringList(row.roles, normalizeRole) ??
            legacyOption?.roles ??
            null,
          groups:
            sanitizeStringList(row.groups, (value) => normalizeGroup(value)) ??
            legacyOption?.groups ??
            null,
          recipientOf:
            optionRecipient === "PARENTS"
              ? ("PARENTS" as const)
              : ("SELF" as const),
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .slice(0, 6) ?? null;

  const audience: CommunicationAudience = {
    roles,
    groups,
    recipientOf,
    status: asTrimmedString(raw?.status) ?? defaultAudienceStatus(null),
    yearLevel: asTrimmedString(raw?.yearLevel),
    term: asTrimmedString(raw?.term),
    subject: asTrimmedString(raw?.subject),
    className: asTrimmedString(raw?.className),
    date: asTrimmedString(raw?.date, 32),
    nameQuery: asTrimmedString(raw?.nameQuery, 120),
    userIds: sanitizeUserIds(raw?.userIds),
    assessmentQuery: asTrimmedString(raw?.assessmentQuery, 120),
    enquiryStage: asTrimmedString(raw?.enquiryStage, 80),
    label: asTrimmedString(raw?.label, 180),
    ambiguous:
      Boolean(raw?.ambiguous) ||
      (Boolean(options?.length) && !Boolean(raw?.confirmed)),
    confirmed: Boolean(raw?.confirmed),
    options: options?.length ? options : null,
    type: asTrimmedString(raw?.type, 64),
  };

  if (audience.ambiguous && !audience.confirmed) {
    audience.confirmed = false;
  } else if (!audience.ambiguous) {
    audience.confirmed = true;
  }

  const individualParents =
    audience.recipientOf === "PARENTS" &&
    Boolean(audience.nameQuery?.trim()) &&
    !audience.yearLevel?.trim() &&
    !audience.subject?.trim() &&
    !audience.className?.trim() &&
    !(audience.groups?.length);
  if (!audience.label || individualParents) {
    audience.label = describeAudience({ ...audience, label: null });
  }

  if (!audienceHasTarget(audience) && !options?.length) {
    throw new AppError(
      400,
      "Provide audience filters (roles, groups, or userIds).",
      "ADMIN_AI_COMM_AUDIENCE_INVALID",
    );
  }

  return audience;
}

function requiresAudienceConfirm(audience: CommunicationAudience): boolean {
  return Boolean(audience.ambiguous && !audience.confirmed);
}

function publicAudience(audience: CommunicationAudience): Record<string, unknown> {
  return {
    label: audience.label ?? describeAudience(audience),
    roles: audience.roles ?? [],
    groups: audience.groups ?? [],
    recipientOf: audience.recipientOf ?? "SELF",
    status: audience.status ?? null,
    yearLevel: audience.yearLevel ?? null,
    term: audience.term ?? null,
    subject: audience.subject ?? null,
    className: audience.className ?? null,
    date: audience.date ?? null,
    nameQuery: audience.nameQuery ?? null,
    userIds: audience.userIds ?? [],
    assessmentQuery: audience.assessmentQuery ?? null,
    enquiryStage: audience.enquiryStage ?? null,
    ambiguous: Boolean(audience.ambiguous),
    confirmed: Boolean(audience.confirmed),
  };
}

function sanitizeAttachments(
  raw: unknown,
): CommunicationAttachmentRef[] {
  if (!Array.isArray(raw)) return [];
  const out: CommunicationAttachmentRef[] = [];
  for (const item of raw.slice(0, 5)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const fileId = typeof row.fileId === "string" ? row.fileId.trim() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!fileId || !name) continue;
    out.push({ fileId: fileId.slice(0, 80), name: name.slice(0, 180) });
  }
  return out;
}

const MAX_INLINE_ATTACHMENTS = 3;
const MAX_INLINE_ATTACHMENT_BYTES = 1.5 * 1024 * 1024;

export type InlineEmailAttachment = {
  filename: string;
  content: Buffer;
};

function parseInlineAttachments(raw: unknown): InlineEmailAttachment[] {
  if (!Array.isArray(raw) || !raw.length) return [];
  const out: InlineEmailAttachment[] = [];
  for (const item of raw.slice(0, MAX_INLINE_ATTACHMENTS)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const filename =
      typeof row.filename === "string" ? row.filename.trim().slice(0, 180) : "";
    const contentBase64 =
      typeof row.contentBase64 === "string"
        ? row.contentBase64.replace(/\s+/g, "")
        : "";
    if (!filename || !contentBase64) continue;
    let content: Buffer;
    try {
      content = Buffer.from(contentBase64, "base64");
    } catch {
      throw new AppError(
        400,
        "One of the attachments could not be read.",
        "ADMIN_AI_COMM_ATTACHMENT_INVALID",
      );
    }
    if (!content.length || content.byteLength > MAX_INLINE_ATTACHMENT_BYTES) {
      throw new AppError(
        400,
        "Each attachment must be under 1.5 MB.",
        "ADMIN_AI_COMM_ATTACHMENT_TOO_LARGE",
      );
    }
    out.push({ filename, content });
  }
  return out;
}

function toDraftDto(
  draft: AdminAiCommunicationDraft,
  emptyReason: string | null = null,
) {
  const snapshot = draft.recipientsSnapshot ?? [];
  const selected = snapshot.filter((r) => r.selected !== false);
  const withEmail = selected.filter((r) => recipientHasEmail(r));
  const missingEmail = selected.filter((r) => !recipientHasEmail(r));
  const audienceConfirm = requiresAudienceConfirm(draft.audience);
  const audienceLabel =
    draft.audience.label ?? describeAudience(draft.audience);
  const skippedCount =
    draft.skippedCount ||
    snapshot.filter((r) => r.status === "skipped").length;
  const processedCount =
    draft.processedCount ||
    snapshot.filter(
      (r) => r.status === "sent" || r.status === "failed" || r.status === "skipped",
    ).length;
  const hardCap = assertWithinHardCap(draft.recipientCount);
  const sendable = withEmail.length;
  const typeConfirm = requiresTypeConfirm(sendable);

  return {
    draftId: draft.id,
    channel: draft.channel,
    action: "send_email" as const,
    subject: draft.subject,
    body: draft.body,
    audience: publicAudience(draft.audience),
    audienceLabel,
    recipientCount: draft.recipientCount,
    selectedCount: selected.length,
    sendableCount: sendable,
    missingEmailCount: missingEmail.length,
    excludedCount: missingEmail.length + snapshot.filter((r) => r.selected === false).length,
    emptyReason:
      emptyReason ??
      (audienceConfirm || snapshot.length
        ? null
        : "No recipients match this audience."),
    sentCount: draft.sentCount,
    failedCount: draft.failedCount,
    skippedCount,
    processedCount,
    status: draft.status,
    requiresReauth: draft.requiresReauth,
    requiresTypeConfirm: typeConfirm,
    typeConfirmPhrase: typeConfirm
      ? expectedTypeConfirmPhrase(sendable)
      : null,
    withinLimit: hardCap.ok,
    limitMessage: hardCap.ok ? null : hardCap.message,
    absoluteMaxRecipients: BULK_ABSOLUTE_MAX_RECIPIENTS,
    requiresAudienceConfirm: audienceConfirm,
    audienceOptions: (draft.audience.options ?? []).map((option) => ({
      label: option.label,
      roles: option.roles ?? [],
      groups: option.groups ?? [],
      recipientOf: option.recipientOf ?? "SELF",
    })),
    expiresAt: draft.expiresAt?.toISOString() ?? null,
    previewedAt: draft.previewedAt?.toISOString() ?? null,
    attachments: draft.attachments ?? [],
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  };
}

async function resolveEmptyReason(
  audience: CommunicationAudience,
  recipientCount: number,
): Promise<string | null> {
  if (recipientCount > 0 || requiresAudienceConfirm(audience)) return null;

  const recipientOf = (audience.recipientOf ?? "SELF").toUpperCase();
  const nameQuery = audience.nameQuery?.trim() ?? "";

  if (recipientOf === "PARENTS" && nameQuery) {
    const students = await audienceResolverService.resolveStudentsForAudience({
      ...audience,
      recipientOf: "SELF",
    });
    if (!students.length) {
      return `Couldn't find a student matching "${nameQuery}".`;
    }
    const studentLabel =
      students[0]?.studentName?.trim() ||
      students[0]?.name?.trim() ||
      nameQuery;
    return `No parent or guardian contact is linked to ${studentLabel}.`;
  }

  if (nameQuery) {
    return `Couldn't find recipients matching "${nameQuery}".`;
  }

  return "No recipients match this audience.";
}

function refineAudienceLabelAfterResolve(
  audience: CommunicationAudience,
  recipients: CommunicationRecipientSnapshot[],
): string {
  const base = audience.label?.trim() || describeAudience(audience);
  const recipientOf = (audience.recipientOf ?? "SELF").toUpperCase();
  if (recipientOf !== "PARENTS" || !recipients.length) return base;

  const studentNames = [
    ...new Set(
      recipients.flatMap((row) => row.studentNames ?? []).filter(Boolean),
    ),
  ];
  if (
    studentNames.length === 1 &&
    audience.nameQuery?.trim() &&
    !audience.yearLevel?.trim() &&
    !audience.subject?.trim() &&
    !audience.className?.trim() &&
    !(audience.groups?.length)
  ) {
    return `Parent of ${studentNames[0]}`;
  }

  if (
    recipients.length > 1 &&
    (audience.yearLevel?.trim() ||
      audience.subject?.trim() ||
      audience.className?.trim())
  ) {
    return describeAudience({ ...audience, label: null });
  }

  return base;
}

export class CommunicationDraftService {
  private readonly drafts = AppDataSource.getRepository(
    AdminAiCommunicationDraft,
  );
  private readonly users = AppDataSource.getRepository(User);

  private async requireOwnedDraft(actorId: string, draftId: string) {
    const draft = await this.drafts.findOne({
      where: { id: draftId, ownerUserId: actorId },
    });
    if (!draft) {
      throw new AppError(
        404,
        "Communication draft not found",
        "ADMIN_AI_COMM_DRAFT_NOT_FOUND",
      );
    }
    if (draft.recipientsSnapshot?.length) {
      draft.recipientsSnapshot = sanitizeRecipientsForStorage(
        draft.recipientsSnapshot,
      );
    }
    return draft;
  }

  private async refreshSnapshot(draft: AdminAiCommunicationDraft) {
    if (requiresAudienceConfirm(draft.audience)) {
      draft.recipientsSnapshot = [];
      draft.recipientCount = 0;
      draft.requiresReauth = false;
      draft.previewedAt = new Date();
      draft.expiresAt = new Date(Date.now() + COMM_DRAFT_TTL_MS);
      return this.drafts.save(draft);
    }

    const recipients = sanitizeRecipientsForStorage(
      await audienceResolverService.resolve(draft.audience),
    );
    draft.recipientsSnapshot = recipients;
    draft.recipientCount = recipients.length;
    draft.audience = {
      ...draft.audience,
      label: refineAudienceLabelAfterResolve(draft.audience, recipients),
    };
    draft.requiresReauth = recipients.length >= COMM_BULK_REAUTH_THRESHOLD;
    draft.previewedAt = new Date();
    draft.expiresAt = new Date(Date.now() + COMM_DRAFT_TTL_MS);
    if (draft.status === "draft" || draft.status === "failed") {
      draft.status = "draft";
      draft.sentCount = 0;
      draft.failedCount = 0;
      for (const row of draft.recipientsSnapshot) {
        row.status = "pending";
        row.errorReason = null;
        row.providerMessageId = null;
        if (row.selected === undefined) row.selected = true;
      }
    }
    return this.drafts.save(draft);
  }

  async create(
    actor: AdminAiActor,
    input: {
      channel?: string;
      subject?: string;
      body?: string;
      audience?: Record<string, unknown>;
      attachments?: unknown;
      threadId?: string | null;
    },
  ) {
    const audience = sanitizeAudience(input.audience);
    // Subject/body may be empty — preview UI collects them; Confirm Send validates.
    const subject = (input.subject ?? "").trim().slice(0, 240);
    const body = (input.body ?? "").trim().slice(0, 20000);

    let draft = await this.drafts.save(
      this.drafts.create({
        ownerUserId: actor.id,
        threadId: input.threadId ?? null,
        channel: "email",
        subject,
        body,
        audience,
        attachments: sanitizeAttachments(input.attachments),
        recipientsSnapshot: [],
        recipientCount: 0,
        status: "draft",
        requiresReauth: false,
      }),
    );

    draft = await this.refreshSnapshot(draft);
    const emptyReason = await resolveEmptyReason(
      draft.audience,
      draft.recipientCount,
    );

    await writeAdminAiAudit({
      requestId: randomUUID().replace(/-/g, "").slice(0, 32),
      actor,
      conversationId: draft.threadId,
      eventType: "AI_COMM_DRAFT_CREATED",
      scopeMetadata: {
        draftId: draft.id,
        audience: draft.audience,
        recipientCount: draft.recipientCount,
      },
      resultStatus: "ok",
    });

    return toDraftDto(draft, emptyReason);
  }

  async update(
    actor: AdminAiActor,
    draftId: string,
    input: {
      subject?: string;
      body?: string;
      audience?: Record<string, unknown>;
      attachments?: unknown;
      refreshAudience?: boolean;
      selectedUserIds?: string[] | null;
    },
  ) {
    let draft = await this.requireOwnedDraft(actor.id, draftId);
    if (draft.status !== "draft" && draft.status !== "failed") {
      throw new AppError(
        409,
        "Only draft messages can be edited.",
        "ADMIN_AI_COMM_DRAFT_NOT_EDITABLE",
      );
    }

    if (typeof input.subject === "string") {
      draft.subject = input.subject.trim().slice(0, 240);
    }
    if (typeof input.body === "string") {
      draft.body = input.body.trim().slice(0, 20000);
    }
    if (input.attachments !== undefined) {
      draft.attachments = sanitizeAttachments(input.attachments);
    }

    const audienceChanged = Boolean(input.audience);
    if (input.audience) {
      draft.audience = sanitizeAudience({
        ...(draft.audience as unknown as Record<string, unknown>),
        ...input.audience,
      });
    }

    if (Array.isArray(input.selectedUserIds) && draft.recipientsSnapshot?.length) {
      const selected = new Set(
        input.selectedUserIds
          .filter((id): id is string => typeof id === "string")
          .map((id) => id.trim())
          .filter(Boolean),
      );
      for (const row of draft.recipientsSnapshot) {
        row.selected = selected.has(row.userId);
      }
    }

    await this.drafts.save(draft);

    if (audienceChanged || input.refreshAudience || !draft.recipientsSnapshot?.length) {
      draft = await this.refreshSnapshot(draft);
    }

    const emptyReason = await resolveEmptyReason(
      draft.audience,
      draft.recipientCount,
    );

    await writeAdminAiAudit({
      requestId: randomUUID().replace(/-/g, "").slice(0, 32),
      actor,
      conversationId: draft.threadId,
      eventType: "AI_COMM_DRAFT_UPDATED",
      scopeMetadata: {
        draftId: draft.id,
        recipientCount: draft.recipientCount,
      },
      resultStatus: "ok",
    });

    return toDraftDto(draft, emptyReason);
  }

  async get(actor: AdminAiActor, draftId: string) {
    const draft = await this.requireOwnedDraft(actor.id, draftId);
    const emptyReason = await resolveEmptyReason(
      draft.audience,
      draft.recipientCount,
    );
    return toDraftDto(draft, emptyReason);
  }

  /** Remove an unused draft (e.g. bulk disabled after create). */
  async discard(actor: AdminAiActor, draftId: string) {
    await this.drafts.delete({
      id: draftId,
      ownerUserId: actor.id,
      status: "draft",
    });
  }

  async listRecipients(actor: AdminAiActor, draftId: string) {
    const draft = await this.requireOwnedDraft(actor.id, draftId);
    const emptyReason = await resolveEmptyReason(
      draft.audience,
      draft.recipientCount,
    );
    return {
      draftId: draft.id,
      audienceLabel:
        draft.audience.label ?? describeAudience(draft.audience),
      emptyReason,
      recipients: (draft.recipientsSnapshot ?? []).map((row) => ({
        userId: row.userId,
        name: row.name,
        role: row.role
          ? peopleRoleLabel(row.role as Parameters<typeof peopleRoleLabel>[0])
          : null,
        hasEmail: recipientHasEmail(row),
        studentNames: row.studentNames ?? [],
        relationshipLabel: row.relationshipLabel ?? null,
        selected: row.selected !== false,
        status: row.status,
        errorReason: row.errorReason ?? null,
      })),
    };
  }

  async previewAudience(actor: AdminAiActor, draftId: string) {
    let draft = await this.requireOwnedDraft(actor.id, draftId);
    draft = await this.refreshSnapshot(draft);
    await writeAdminAiAudit({
      requestId: randomUUID().replace(/-/g, "").slice(0, 32),
      actor,
      conversationId: draft.threadId,
      eventType: "AI_COMM_PREVIEWED",
      scopeMetadata: {
        draftId: draft.id,
        recipientCount: draft.recipientCount,
      },
      resultStatus: "ok",
    });
    const emptyReason = await resolveEmptyReason(
      draft.audience,
      draft.recipientCount,
    );
    return toDraftDto(draft, emptyReason);
  }

  async confirmSend(
    actor: AdminAiActor,
    draftId: string,
    input: {
      password?: string;
      subject?: string;
      body?: string;
      retryFailedOnly?: boolean;
      selectedUserIds?: string[] | null;
      attachments?: unknown;
      confirmationText?: string;
    },
  ) {
    const draft = await this.requireOwnedDraft(actor.id, draftId);
    const inlineAttachments = input.retryFailedOnly
      ? []
      : parseInlineAttachments(input.attachments);

    if (input.retryFailedOnly) {
      if (draft.status !== "partially_sent" && draft.status !== "failed") {
        throw new AppError(
          409,
          "There are no failed recipients to retry.",
          "ADMIN_AI_COMM_RETRY_INVALID",
        );
      }
    } else if (draft.status !== "draft") {
      throw new AppError(
        409,
        "This message was already sent or is in progress.",
        "ADMIN_AI_COMM_ALREADY_SENDING",
      );
    }

    if (!input.retryFailedOnly && requiresAudienceConfirm(draft.audience)) {
      throw new AppError(
        409,
        "Confirm the audience before sending.",
        "ADMIN_AI_COMM_AUDIENCE_CONFIRM_REQUIRED",
      );
    }

    if (!input.retryFailedOnly) {
      if (!draft.expiresAt || draft.expiresAt.getTime() < Date.now()) {
        throw new AppError(
          409,
          "This preview has expired. Refresh the audience and try again.",
          "ADMIN_AI_COMM_DRAFT_EXPIRED",
        );
      }
    }

    if (typeof input.subject === "string") {
      draft.subject = input.subject.trim().slice(0, 240);
    }
    if (typeof input.body === "string") {
      draft.body = input.body.trim().slice(0, 20000);
    }

    if (!input.retryFailedOnly) {
      if (!draft.subject.trim()) {
        throw new AppError(
          400,
          "Please enter a subject before sending.",
          "ADMIN_AI_COMM_SUBJECT_REQUIRED",
        );
      }
      if (!draft.body.trim()) {
        throw new AppError(
          400,
          "Please enter a message before sending.",
          "ADMIN_AI_COMM_BODY_REQUIRED",
        );
      }
    }

    if (
      Array.isArray(input.selectedUserIds) &&
      draft.recipientsSnapshot?.length &&
      !input.retryFailedOnly
    ) {
      const selected = new Set(
        input.selectedUserIds
          .filter((id): id is string => typeof id === "string")
          .map((id) => id.trim())
          .filter(Boolean),
      );
      for (const row of draft.recipientsSnapshot) {
        row.selected = selected.has(row.userId);
      }
    }

    const snapshot = draft.recipientsSnapshot ?? [];
    if (!snapshot.length) {
      const emptyReason = await resolveEmptyReason(draft.audience, 0);
      throw new AppError(
        400,
        emptyReason ?? "No recipients in this draft.",
        "ADMIN_AI_COMM_NO_RECIPIENTS",
      );
    }

    const selectedRows = snapshot.filter((row) => row.selected !== false);
    if (!selectedRows.length) {
      throw new AppError(
        400,
        "Select at least one recipient before sending.",
        "ADMIN_AI_COMM_NO_SELECTED",
      );
    }

    const targets = input.retryFailedOnly
      ? snapshot.filter((row) => row.status === "failed")
      : selectedRows.filter((row) => recipientHasEmail(row));

    if (!targets.length) {
      throw new AppError(
        400,
        input.retryFailedOnly
          ? "No failed recipients to retry."
          : "No selected recipients have an email address.",
        "ADMIN_AI_COMM_NO_SENDABLE",
      );
    }

    if (!input.retryFailedOnly) {
      const hardCap = assertWithinHardCap(targets.length);
      if (!hardCap.ok) {
        throw new AppError(
          400,
          hardCap.message,
          "ADMIN_AI_BULK_CAP_EXCEEDED",
        );
      }
      if (requiresTypeConfirm(targets.length)) {
        const expected = expectedTypeConfirmPhrase(targets.length);
        const typed = (input.confirmationText ?? "").trim().toUpperCase();
        if (typed !== expected) {
          throw new AppError(
            400,
            `Type ${expected} to continue.`,
            "ADMIN_AI_BULK_TYPE_CONFIRM_REQUIRED",
          );
        }
      }
    }

    if (
      !input.retryFailedOnly &&
      draft.requiresReauth &&
      targets.length >= COMM_BULK_REAUTH_THRESHOLD
    ) {
      const password = input.password?.trim() ?? "";
      if (!password) {
        throw new AppError(
          401,
          "Re-authentication required for bulk send.",
          "ADMIN_AI_COMM_REAUTH_REQUIRED",
        );
      }
      const user = await this.users.findOne({
        where: { id: actor.id },
        select: { id: true, passwordHash: true },
      });
      if (!user?.passwordHash) {
        throw new AppError(
          401,
          "Re-authentication required for bulk send.",
          "ADMIN_AI_COMM_REAUTH_REQUIRED",
        );
      }
      const ok = await verifyPassword(password, user.passwordHash);
      if (!ok) {
        throw new AppError(
          401,
          "Password incorrect. Re-authentication failed.",
          "ADMIN_AI_COMM_REAUTH_FAILED",
        );
      }
      await writeAdminAiAudit({
        requestId: randomUUID().replace(/-/g, "").slice(0, 32),
        actor,
        conversationId: draft.threadId,
        eventType: "AI_COMM_REAUTH_OK",
        scopeMetadata: { draftId: draft.id, recipientCount: targets.length },
        resultStatus: "ok",
      });
    }

    if (inlineAttachments.length) {
      draft.attachments = inlineAttachments.map((file, index) => ({
        fileId: `inline-${index + 1}`,
        name: file.filename,
      }));
    }

    const idempotencyKey =
      draft.idempotencyKey && input.retryFailedOnly
        ? `${draft.idempotencyKey}-retry-${Date.now()}`
        : randomUUID().replace(/-/g, "").slice(0, 32);
    draft.idempotencyKey = idempotencyKey;
    await this.drafts.save(draft);

    await storeBulkActionAttachments(draft.id, inlineAttachments);

    // Atomic claim: draft|failed|partially_sent → queued (frozen snapshot)
    const claim = await this.drafts
      .createQueryBuilder()
      .update(AdminAiCommunicationDraft)
      .set({
        status: "queued",
        subject: draft.subject,
        body: draft.body,
        recipientsSnapshot: draft.recipientsSnapshot,
        attachments: draft.attachments,
        idempotencyKey,
        processedCount: input.retryFailedOnly ? draft.processedCount : 0,
        skippedCount: input.retryFailedOnly ? draft.skippedCount : 0,
        sentCount: input.retryFailedOnly ? draft.sentCount : 0,
        failedCount: input.retryFailedOnly ? 0 : 0,
      })
      .where("id = :id AND ownerUserId = :ownerUserId", {
        id: draft.id,
        ownerUserId: actor.id,
      })
      .andWhere(
        input.retryFailedOnly
          ? "status IN (:...statuses)"
          : "status = :status",
        input.retryFailedOnly
          ? { statuses: ["partially_sent", "failed"] }
          : { status: "draft" },
      )
      .execute();

    if (!claim.affected) {
      throw new AppError(
        409,
        "This message was already sent or is in progress.",
        "ADMIN_AI_COMM_ALREADY_SENDING",
      );
    }

    let jobId: string;
    try {
      jobId = await enqueueBulkActionJob({
        draftId: draft.id,
        action: "send_email",
        requestedBy: actor.id,
        idempotencyKey,
        retryFailedOnly: Boolean(input.retryFailedOnly),
      });
    } catch (error) {
      await this.drafts
        .createQueryBuilder()
        .update(AdminAiCommunicationDraft)
        .set({ status: input.retryFailedOnly ? "partially_sent" : "draft" })
        .where("id = :id AND status = :status", {
          id: draft.id,
          status: "queued",
        })
        .execute();
      await storeBulkActionAttachments(draft.id, []).catch(() => undefined);
      if (error instanceof AppError) throw error;
      throw new AppError(
        503,
        "Messaging is temporarily unavailable. Please try again in a moment.",
        "ADMIN_AI_COMM_QUEUE_UNAVAILABLE",
      );
    }

    await this.drafts
      .createQueryBuilder()
      .update(AdminAiCommunicationDraft)
      .set({ jobId })
      .where("id = :id", { id: draft.id })
      .execute();

    await writeAdminAiAudit({
      requestId: randomUUID().replace(/-/g, "").slice(0, 32),
      actor,
      conversationId: draft.threadId,
      eventType: "AI_COMM_SEND_STARTED",
      scopeMetadata: {
        draftId: draft.id,
        targetCount: targets.length,
        retryFailedOnly: Boolean(input.retryFailedOnly),
        attachmentCount: inlineAttachments.length,
        queued: true,
        jobId,
        confirmationType: requiresTypeConfirm(targets.length)
          ? "type_confirm"
          : draft.requiresReauth
            ? "password"
            : "click",
      },
      resultStatus: "ok",
    });

    return {
      draftId: draft.id,
      status: "queued" as const,
      recipientCount: draft.recipientCount,
      sentCount: input.retryFailedOnly ? draft.sentCount : 0,
      failedCount: 0,
      skippedCount: 0,
      processedCount: 0,
      targetCount: targets.length,
      failures: [] as Array<{ name: string; errorReason: string }>,
    };
  }
}

export const communicationDraftService = new CommunicationDraftService();
