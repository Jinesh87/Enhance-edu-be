import { AppDataSource } from "../../../../config/data-source.js";
import { AppError } from "../../../../common/errors/AppError.js";
import { UserRole } from "../../../../common/constants/roles.js";
import { Announcement } from "../../../../entities/Announcement.js";
import { Notification } from "../../../../entities/Notification.js";
import type { CommunicationAudience } from "../../../../entities/AdminAiCommunicationDraft.js";
import { logger } from "../../../../config/logger.js";
import { writeAdminAiAudit } from "../audit.js";
import type { AdminAiActor } from "../authorization.js";
import { audienceResolverService } from "../communications/audience.resolver.js";
import {
  describeAudience,
  expandLegacyType,
  normalizeGroup,
  normalizeRole,
  defaultAudienceStatus,
} from "../communications/audience.normalize.js";
import { userNotificationManager } from "../../../notifications/notification-updates.js";
import { notificationsService } from "../../../notifications/notifications.service.js";

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

export function sanitizeAudience(
  raw: Record<string, unknown> | null | undefined,
): CommunicationAudience {
  const legacy = expandLegacyType(asTrimmedString(raw?.type, 64));

  let roles =
    sanitizeStringList(raw?.roles, normalizeRole) ?? legacy?.roles ?? null;
  let groups =
    sanitizeStringList(raw?.groups, (value) => normalizeGroup(value)) ??
    legacy?.groups ??
    null;

  const recipientRaw = String(raw?.recipientOf ?? legacy?.recipientOf ?? "SELF")
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

  const optionsRaw = Array.isArray(raw?.options) ? raw?.options : null;
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

  if (!audience.label) {
    audience.label = describeAudience({ ...audience, label: null });
  }

  return audience;
}

export function publicAudience(
  audience: CommunicationAudience,
): Record<string, unknown> {
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

// In-memory idempotency cache for active publish requests (prevents accidental double publish)
const recentPublishes = new Map<string, number>();
const IDEMPOTENCY_TTL_MS = 15_000;

function cleanupIdempotency() {
  const now = Date.now();
  for (const [key, timestamp] of recentPublishes.entries()) {
    if (now - timestamp > IDEMPOTENCY_TTL_MS) {
      recentPublishes.delete(key);
    }
  }
}

export class AnnouncementService {
  private assertCanManageAnnouncements(actor: AdminAiActor) {
    if (
      actor.role !== UserRole.SUPER_ADMIN &&
      actor.role !== UserRole.OFFICE_STAFF
    ) {
      throw new AppError(
        403,
        "You do not have permission to create or publish announcements.",
        "ANNOUNCEMENT_FORBIDDEN",
      );
    }
  }

  async previewDraft(
    actor: AdminAiActor,
    input: {
      title?: string;
      message?: string;
      audience?: Record<string, unknown> | CommunicationAudience;
      threadId?: string | null;
    },
  ) {
    this.assertCanManageAnnouncements(actor);

    const title = input.title?.trim() || "";
    const message = input.message?.trim() || "";
    const audience = sanitizeAudience(
      input.audience as Record<string, unknown>,
    );

    const recipients =
      audience.ambiguous && !audience.confirmed
        ? []
        : await audienceResolverService.resolve(audience);

    const audienceLabel = audience.label ?? describeAudience(audience);
    const recipientCount = recipients.length;

    logger.info(
      {
        userId: actor.id,
        audienceLabel,
        recipientCount,
      },
      "announcement.preview.created",
    );

    return {
      title,
      message,
      audience: publicAudience(audience),
      audienceLabel,
      recipientCount,
      recipients: recipients.map((r) => ({
        userId: r.userId,
        name: r.name,
        role: r.role,
        studentNames: r.studentNames,
        relationshipLabel: r.relationshipLabel,
        hasEmail: r.hasEmail,
        selected: true,
        status: r.status,
      })),
      deliveryChannel: "IN_APP" as const,
      requiresAudienceConfirm: Boolean(
        audience.ambiguous && !audience.confirmed,
      ),
      audienceOptions: (audience.options ?? []).map((opt) => ({
        label: opt.label,
        roles: opt.roles ?? [],
        groups: opt.groups ?? [],
        recipientOf: opt.recipientOf ?? "SELF",
      })),
      responseHint: [
        "Announcement DRAFT prepared — nothing has been published.",
        "Audience resolved to: " +
          audienceLabel +
          " (" +
          recipientCount +
          " recipients).",
        "Delivery channel: IN_APP only.",
        "Review and click Approve & Publish in the UI to publish.",
      ].join(" "),
    };
  }

  async publishAnnouncement(
    actor: AdminAiActor,
    input: {
      title: string;
      message: string;
      audience: Record<string, unknown> | CommunicationAudience;
      excludedUserIds?: string[];
      idempotencyKey?: string;
    },
  ) {
    const started = Date.now();
    this.assertCanManageAnnouncements(actor);

    const title = (input.title ?? "").trim();
    if (!title) {
      throw new AppError(
        400,
        "Announcement title is required.",
        "ANNOUNCEMENT_TITLE_REQUIRED",
      );
    }
    if (title.length > 200) {
      throw new AppError(
        400,
        "Announcement title must be at most 200 characters.",
        "ANNOUNCEMENT_TITLE_TOO_LONG",
      );
    }

    const message = (input.message ?? "").trim();
    if (!message) {
      throw new AppError(
        400,
        "Announcement message is required.",
        "ANNOUNCEMENT_MESSAGE_REQUIRED",
      );
    }
    if (message.length > 4000) {
      throw new AppError(
        400,
        "Announcement message must be at most 4000 characters.",
        "ANNOUNCEMENT_MESSAGE_TOO_LONG",
      );
    }

    const audience = sanitizeAudience(
      input.audience as Record<string, unknown>,
    );
    if (audience.ambiguous && !audience.confirmed) {
      throw new AppError(
        400,
        "Audience is ambiguous. Please select a specific audience target first.",
        "ANNOUNCEMENT_AUDIENCE_AMBIGUOUS",
      );
    }

    cleanupIdempotency();
    const idempotencyKey =
      input.idempotencyKey?.trim() ||
      `${actor.id}:${title}:${message.slice(0, 50)}`;
    if (recentPublishes.has(idempotencyKey)) {
      throw new AppError(
        409,
        "This announcement is already being published or was just published. Please avoid double-clicking.",
        "ANNOUNCEMENT_ALREADY_PUBLISHED",
      );
    }
    recentPublishes.set(idempotencyKey, Date.now());

    logger.info({ userId: actor.id, title }, "announcement.publish.started");

    try {
      // 1. Re-resolve audience from database (source of truth)
      const recipients = await audienceResolverService.resolve(audience);
      if (!recipients.length) {
        throw new AppError(
          400,
          "No matching recipients found for the selected audience.",
          "ANNOUNCEMENT_NO_RECIPIENTS",
        );
      }

      const allResolvedIds = [...new Set(recipients.map((r) => r.userId))];
      const excludedSet = new Set(input.excludedUserIds ?? []);
      const recipientUserIds = allResolvedIds.filter((id) => !excludedSet.has(id));
      if (!recipientUserIds.length) {
        throw new AppError(
          400,
          "No recipients remain after excluding the selected users.",
          "ANNOUNCEMENT_NO_RECIPIENTS",
        );
      }
      const audienceLabel = audience.label ?? describeAudience(audience);

      // 2. Perform atomic transaction: Save Announcement + In-App Notifications
      let savedAnnouncement: Announcement;
      try {
        savedAnnouncement = await AppDataSource.transaction(async (manager) => {
          const announcementRepo = manager.getRepository(Announcement);
          const notificationRepo = manager.getRepository(Notification);

          const announcement = announcementRepo.create({
            title,
            message,
            createdBy: actor.id,
            approvedBy: actor.id,
            publishedAt: new Date(),
            status: "PUBLISHED",
            audienceSnapshot: audience,
            recipientCount: recipientUserIds.length,
            deliveryChannel: "IN_APP",
          });

          const createdAnnouncement = await announcementRepo.save(announcement);

          // Concise notification body (avoid huge dumps)
          const notificationBody =
            message.length > 200 ? `${message.slice(0, 197)}…` : message;

          const notifications = recipientUserIds.map((userId) =>
            notificationRepo.create({
              userId,
              type: "ANNOUNCEMENT",
              title,
              body: notificationBody,
              data: {
                announcementId: createdAnnouncement.id,
                audienceLabel,
                publishedAt: createdAnnouncement.publishedAt.toISOString(),
              },
              readAt: null,
            }),
          );

          await notificationRepo.save(notifications);
          return createdAnnouncement;
        });
      } catch (dbError) {
        logger.error(
          { err: dbError, userId: actor.id },
          "announcement.publish.failed",
        );
        throw new AppError(
          500,
          "Failed to publish announcement. Database transaction error.",
          "ANNOUNCEMENT_PUBLISH_FAILED",
        );
      }

      // 3. Broadcast real-time SSE updates to all recipients
      try {
        const notificationBody =
          message.length > 200 ? `${message.slice(0, 197)}…` : message;
        for (const userId of recipientUserIds) {
          const unreadCount = await notificationsService
            .countUnread(userId)
            .catch(() => 1);
          userNotificationManager.publish({
            userId,
            type: "NOTIFICATION_CREATED",
            unreadCount,
            notification: {
              id: savedAnnouncement.id,
              type: "ANNOUNCEMENT",
              title,
              body: notificationBody,
              data: {
                announcementId: savedAnnouncement.id,
                audienceLabel,
                publishedAt: savedAnnouncement.publishedAt.toISOString(),
              },
              readAt: null,
              createdAt: savedAnnouncement.createdAt.toISOString(),
            },
          });
        }
      } catch (sseError) {
        logger.warn(
          { err: sseError },
          "Failed to broadcast SSE notifications for announcement",
        );
      }

      // 4. Save Audit Log
      await writeAdminAiAudit({
        requestId: `pub-announcement-${savedAnnouncement.id}`,
        actor,
        eventType: "ANNOUNCEMENT_PUBLISHED",
        mode: "DRAFT",
        scopeMetadata: {
          announcementId: savedAnnouncement.id,
          approvedBy: actor.id,
          audienceSummary: audienceLabel,
          recipientCount: recipientUserIds.length,
          deliveryChannel: "IN_APP",
        },
        resultStatus: "SUCCESS",
      });

      const duration = Date.now() - started;
      logger.info(
        {
          userId: actor.id,
          announcementId: savedAnnouncement.id,
          recipientCount: recipientUserIds.length,
          durationMs: duration,
        },
        "announcement.published",
      );

      return {
        announcementId: savedAnnouncement.id,
        title: savedAnnouncement.title,
        message: savedAnnouncement.message,
        audienceLabel,
        recipientCount: recipientUserIds.length,
        deliveryChannel: savedAnnouncement.deliveryChannel,
        publishedAt: savedAnnouncement.publishedAt.toISOString(),
      };
    } finally {
      recentPublishes.delete(idempotencyKey);
    }
  }
}

export const announcementService = new AnnouncementService();
