import { AppDataSource } from "../../../../config/data-source.js";
import { AppError } from "../../../../common/errors/AppError.js";
import { UserRole } from "../../../../common/constants/roles.js";
import {
  Announcement,
  type AnnouncementSeverity,
} from "../../../../entities/Announcement.js";
import { Notification } from "../../../../entities/Notification.js";
import { User } from "../../../../entities/User.js";
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
import { settingsService } from "../../../settings/settings.service.js";
import { emailService } from "../../../email/email.service.js";

const CHANNEL_CONCURRENCY = 5;

async function mapPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (!items.length) return;
  let index = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (index < items.length) {
        const current = items[index++];
        await worker(current);
      }
    },
  );
  await Promise.all(runners);
}

function parseSeverity(raw: unknown): AnnouncementSeverity {
  return String(raw ?? "")
    .trim()
    .toUpperCase() === "EMERGENCY"
    ? "EMERGENCY"
    : "GENERAL";
}

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

  // Default audience: everyone when no roles/groups/userIds given.
  if (
    !audience.roles?.length &&
    !audience.groups?.length &&
    !audience.userIds?.length &&
    !(audience.ambiguous && !audience.confirmed)
  ) {
    audience.roles = ["ALL"];
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
      severity?: AnnouncementSeverity | string;
    },
  ) {
    this.assertCanManageAnnouncements(actor);

    const title = input.title?.trim() || "";
    const message = input.message?.trim() || "";
    const severity = parseSeverity(input.severity);
    const audience = sanitizeAudience(
      input.audience as Record<string, unknown>,
    );

    const recipients =
      audience.ambiguous && !audience.confirmed
        ? []
        : await audienceResolverService.resolve(audience);

    const audienceLabel = audience.label ?? describeAudience(audience);
    const recipientCount = recipients.length;
    const deliveryChannel =
      severity === "EMERGENCY" ? "IN_APP,PUSH,EMAIL,SMS" : "IN_APP,EMAIL";

    logger.info(
      {
        userId: actor.id,
        audienceLabel,
        recipientCount,
        severity,
      },
      "announcement.preview.created",
    );

    return {
      title,
      message,
      severity,
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
      deliveryChannel,
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
        severity === "EMERGENCY"
          ? "Emergency alert DRAFT prepared — nothing has been published."
          : "Announcement DRAFT prepared — nothing has been published.",
        "Audience resolved to: " +
          audienceLabel +
          " (" +
          recipientCount +
          " recipients).",
        severity === "EMERGENCY"
          ? "Delivery channels: in-app, push, email, and SMS (gated by settings)."
          : "Delivery channels: in-app and email (email gated by settings).",
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
      severity?: AnnouncementSeverity | string;
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

    const severity = parseSeverity(input.severity);
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
      `${severity}:${actor.id}:${title}:${message.slice(0, 50)}`;
    if (recentPublishes.has(idempotencyKey)) {
      throw new AppError(
        409,
        "This announcement is already being published or was just published. Please avoid double-clicking.",
        "ANNOUNCEMENT_ALREADY_PUBLISHED",
      );
    }
    recentPublishes.set(idempotencyKey, Date.now());

    logger.info(
      { userId: actor.id, title, severity },
      "announcement.publish.started",
    );

    try {
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
      const recipientUserIds = allResolvedIds.filter(
        (id) => !excludedSet.has(id),
      );
      if (!recipientUserIds.length) {
        throw new AppError(
          400,
          "No recipients remain after excluding the selected users.",
          "ANNOUNCEMENT_NO_RECIPIENTS",
        );
      }

      const audienceLabel = audience.label ?? describeAudience(audience);
      const notificationBody =
        message.length > 200 ? `${message.slice(0, 197)}…` : message;
      const notificationType =
        severity === "EMERGENCY" ? ("EMERGENCY_ALERT" as const) : ("ANNOUNCEMENT" as const);

      const [
        announcementEmailEnabled,
        emergencyInAppEnabled,
        emergencyEmailEnabled,
        emergencySmsEnabled,
      ] = await Promise.all([
        settingsService.isAnnouncementEmailEnabled(),
        settingsService.isEmergencyAlertInAppEnabled(),
        settingsService.isEmergencyAlertEmailEnabled(),
        settingsService.isEmergencyAlertSmsEnabled(),
      ]);

      const channelsUsed: string[] = [];
      const wantInApp =
        severity === "GENERAL" ||
        (severity === "EMERGENCY" && emergencyInAppEnabled);
      const wantEmail =
        severity === "GENERAL"
          ? announcementEmailEnabled
          : emergencyEmailEnabled;
      const wantSms = severity === "EMERGENCY" && emergencySmsEnabled;

      if (wantInApp) channelsUsed.push("IN_APP");
      if (severity === "EMERGENCY" && wantInApp) channelsUsed.push("PUSH");
      if (wantEmail) channelsUsed.push("EMAIL");
      if (wantSms) channelsUsed.push("SMS");

      const deliveryChannel =
        channelsUsed.length > 0 ? channelsUsed.join(",") : "NONE";

      let savedAnnouncement: Announcement;
      try {
        savedAnnouncement = await AppDataSource.transaction(async (manager) => {
          const announcementRepo = manager.getRepository(Announcement);
          const announcement = announcementRepo.create({
            title,
            message,
            createdBy: actor.id,
            approvedBy: actor.id,
            publishedAt: new Date(),
            status: "PUBLISHED",
            severity,
            audienceSnapshot: audience,
            recipientCount: recipientUserIds.length,
            deliveryChannel,
          });
          return announcementRepo.save(announcement);
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

      const notifData = {
        announcementId: savedAnnouncement.id,
        audienceLabel,
        severity,
        publishedAt: savedAnnouncement.publishedAt.toISOString(),
      };

      if (wantInApp) {
        if (severity === "EMERGENCY") {
          await notificationsService.createMany(
            recipientUserIds.map((userId) => ({
              userId,
              type: notificationType,
              title,
              body: notificationBody,
              data: notifData,
            })),
          );
        } else {
          try {
            await AppDataSource.transaction(async (manager) => {
              const notificationRepo = manager.getRepository(Notification);
              const notifications = recipientUserIds.map((userId) =>
                notificationRepo.create({
                  userId,
                  type: notificationType,
                  title,
                  body: notificationBody,
                  data: notifData,
                  readAt: null,
                }),
              );
              await notificationRepo.save(notifications);
            });
          } catch (dbError) {
            logger.error(
              { err: dbError, userId: actor.id },
              "announcement.notifications.failed",
            );
            throw new AppError(
              500,
              "Failed to publish announcement notifications.",
              "ANNOUNCEMENT_PUBLISH_FAILED",
            );
          }

          try {
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
                  type: notificationType,
                  title,
                  body: notificationBody,
                  data: notifData,
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
        }
      }

      if (wantEmail || wantSms) {
        const users = await AppDataSource.getRepository(User)
          .createQueryBuilder("u")
          .select(["u.id", "u.email", "u.mobile", "u.fullName"])
          .where("u.id IN (:...ids)", { ids: recipientUserIds })
          .getMany();

        if (wantEmail) {
          const emailTargets = users.filter((u) => Boolean(u.email?.trim()));
          await mapPool(emailTargets, CHANNEL_CONCURRENCY, async (user) => {
            try {
              await emailService.sendAnnouncementEmail({
                to: user.email!.trim(),
                fullName: user.fullName?.trim() || "there",
                title,
                message,
                emergency: severity === "EMERGENCY",
              });
            } catch (error) {
              logger.warn(
                { err: error, userId: user.id },
                "Announcement email failed",
              );
            }
          });
        }

        if (wantSms) {
          const smsBody = `EMERGENCY: ${title}. ${notificationBody}`.slice(
            0,
            320,
          );
          const smsTargets = users.filter((u) => Boolean(u.mobile?.trim()));
          await mapPool(smsTargets, CHANNEL_CONCURRENCY, async (user) => {
            try {
              await emailService.sendSessionChangeSms({
                to: user.mobile!.trim(),
                body: smsBody,
              });
            } catch (error) {
              logger.warn(
                { err: error, userId: user.id },
                "Emergency alert SMS failed",
              );
            }
          });
        }
      }

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
          deliveryChannel,
          severity,
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
          severity,
          deliveryChannel,
        },
        "announcement.published",
      );

      return {
        announcementId: savedAnnouncement.id,
        title: savedAnnouncement.title,
        message: savedAnnouncement.message,
        severity,
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
