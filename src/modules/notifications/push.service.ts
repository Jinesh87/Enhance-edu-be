import webpush from "web-push";
import { AppError } from "../../common/errors/AppError.js";
import { AppDataSource } from "../../config/data-source.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { PushSubscription } from "../../entities/PushSubscription.js";
import type { NotificationDto } from "./notifications.service.js";

export type PushSubscribeInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string | null;
};

export type PushNotificationTarget = {
  userId: string;
  notification: NotificationDto;
};

let vapidConfigured = false;

function ensureVapid(): boolean {
  if (vapidConfigured) return true;
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(
    env.VAPID_SUBJECT || "mailto:admin@enhance.education",
    publicKey,
    privateKey,
  );
  vapidConfigured = true;
  return true;
}

export function isWebPushConfigured(): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY?.trim() && env.VAPID_PRIVATE_KEY?.trim());
}

export function getVapidPublicKey(): string | null {
  const key = env.VAPID_PUBLIC_KEY?.trim();
  return key || null;
}

export class PushSubscriptionService {
  private readonly repo = () => AppDataSource.getRepository(PushSubscription);

  async upsert(userId: string, input: PushSubscribeInput) {
    const endpoint = input.endpoint.trim();
    if (!endpoint || !input.keys?.p256dh || !input.keys?.auth) {
      throw new AppError(
        400,
        "Invalid push subscription",
        "INVALID_PUSH_SUBSCRIPTION",
      );
    }

    let row = await this.repo().findOne({ where: { endpoint } });
    if (!row) {
      row = this.repo().create({
        userId,
        endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: input.userAgent?.slice(0, 255) ?? null,
      });
    } else {
      row.userId = userId;
      row.p256dh = input.keys.p256dh;
      row.auth = input.keys.auth;
      row.userAgent = input.userAgent?.slice(0, 255) ?? row.userAgent;
    }
    return this.repo().save(row);
  }

  async remove(userId: string, endpoint: string) {
    const result = await this.repo().delete({
      userId,
      endpoint: endpoint.trim(),
    });
    return (result.affected ?? 0) > 0;
  }

  async sendNotificationTargets(targets: PushNotificationTarget[]) {
    if (!ensureVapid() || targets.length === 0) return;

    const byUser = new Map<string, NotificationDto[]>();
    for (const target of targets) {
      const list = byUser.get(target.userId) ?? [];
      list.push(target.notification);
      byUser.set(target.userId, list);
    }

    for (const [userId, notes] of byUser) {
      await this.sendToUser(userId, notes);
    }
  }

  private async sendToUser(userId: string, notes: NotificationDto[]) {
    const subs = await this.repo().find({ where: { userId } });
    if (subs.length === 0) return;

    for (const note of notes) {
      const payload = JSON.stringify({
        title: note.title,
        body: note.body,
        data: {
          notificationId: note.id,
          type: note.type,
          ...(note.data ?? {}),
        },
      });

      await Promise.all(
        subs.map(async (sub) => {
          try {
            await webpush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth },
              },
              payload,
            );
          } catch (error) {
            const statusCode =
              error && typeof error === "object" && "statusCode" in error
                ? Number((error as { statusCode?: number }).statusCode)
                : 0;
            if (statusCode === 404 || statusCode === 410) {
              await this.repo().delete({ id: sub.id });
              return;
            }
            logger.warn(
              { err: error, userId, endpoint: sub.endpoint },
              "Web push send failed",
            );
          }
        }),
      );
    }
  }
}

export const pushSubscriptionService = new PushSubscriptionService();
