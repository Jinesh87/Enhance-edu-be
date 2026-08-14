import type { Response } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import { logger } from "../../../config/logger.js";
import { redis, redisSubscriber } from "../../../config/redis.js";

const CHANNEL = "notifications:admin";

export type AdminNotificationPayload = {
  type: "TASKS_CREATED" | "TASK_COMPLETED";
  role: UserRole;
  count: number;
  openCount: number;
  title: string;
  body?: string;
};

class AdminNotificationManager {
  private readonly clients = new Set<Response>();

  constructor() {
    redisSubscriber.on("message", (channel: string, message: string) => {
      if (channel !== CHANNEL) return;

      const sseMessage = `data: ${message}\n\n`;
      for (const client of this.clients) {
        try {
          client.write(sseMessage);
        } catch (error) {
          logger.error({ err: error }, "Error writing to admin SSE client");
        }
      }
    });

    redisSubscriber.subscribe(CHANNEL).catch((error) => {
      logger.error({ err: error }, "Failed to subscribe to admin notifications");
    });
  }

  register(res: Response) {
    this.clients.add(res);
    res.on("close", () => {
      this.clients.delete(res);
    });
  }

  broadcast(payload: AdminNotificationPayload) {
    redis.publish(CHANNEL, JSON.stringify(payload)).catch((error) => {
      logger.error({ err: error }, "Failed to publish admin notification");
    });
  }
}

export const adminNotificationManager = new AdminNotificationManager();
