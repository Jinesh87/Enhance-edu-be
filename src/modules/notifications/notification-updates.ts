import type { Response } from "express";
import { logger } from "../../config/logger.js";
import { redis, redisSubscriber } from "../../config/redis.js";

const CHANNEL = "notifications:user";

export type UserNotificationSsePayload = {
  userId: string;
  type: "NOTIFICATION_CREATED" | "NOTIFICATION_READ" | "UNREAD_COUNT";
  unreadCount: number;
  notification?: {
    id: string;
    type: string;
    title: string;
    body: string;
    data: Record<string, unknown> | null;
    readAt: string | null;
    createdAt: string;
  };
};

class UserNotificationManager {
  private readonly clientsByUser = new Map<string, Set<Response>>();

  constructor() {
    redisSubscriber.on("message", (channel: string, message: string) => {
      if (channel !== CHANNEL) return;

      try {
        const payload = JSON.parse(message) as UserNotificationSsePayload;
        const clients = this.clientsByUser.get(payload.userId);
        if (!clients || clients.size === 0) return;

        const sseMessage = `data: ${JSON.stringify(payload)}\n\n`;
        for (const client of clients) {
          try {
            client.write(sseMessage);
          } catch (error) {
            logger.error({ err: error }, "Error writing to notification SSE client");
          }
        }
      } catch (error) {
        logger.error({ err: error }, "Error handling notification Redis message");
      }
    });

    redisSubscriber.subscribe(CHANNEL).catch((error: unknown) => {
      logger.error({ err: error }, "Failed to subscribe to user notifications");
    });
  }

  register(userId: string, res: Response) {
    if (!this.clientsByUser.has(userId)) {
      this.clientsByUser.set(userId, new Set());
    }
    this.clientsByUser.get(userId)!.add(res);

    const ping = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        clearInterval(ping);
      }
    }, 25_000);

    res.on("close", () => {
      clearInterval(ping);
      const clients = this.clientsByUser.get(userId);
      if (!clients) return;
      clients.delete(res);
      if (clients.size === 0) {
        this.clientsByUser.delete(userId);
      }
    });
  }

  publish(payload: UserNotificationSsePayload) {
    redis.publish(CHANNEL, JSON.stringify(payload)).catch((error: unknown) => {
      logger.error({ err: error }, "Failed to publish user notification");
    });
  }
}

export const userNotificationManager = new UserNotificationManager();
