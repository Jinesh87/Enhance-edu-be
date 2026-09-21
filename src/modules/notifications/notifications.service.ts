import { AppDataSource } from "../../config/data-source.js";
import { AppError } from "../../common/errors/AppError.js";
import {
  Notification,
  type NotificationType,
} from "../../entities/Notification.js";
import { IsNull } from "typeorm";
import { userNotificationManager } from "./notification-updates.js";
import { pushSubscriptionService } from "./push.service.js";
import { logger } from "../../config/logger.js";

export type NotificationDto = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
};

export type CreateNotificationInput = {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
};

function toDto(row: Notification): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    data: row.data ?? null,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export class NotificationsService {
  private readonly repo = AppDataSource.getRepository(Notification);

  async createMany(inputs: CreateNotificationInput[]): Promise<NotificationDto[]> {
    if (inputs.length === 0) return [];

    const rows = inputs.map((input) =>
      this.repo.create({
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data ?? null,
        readAt: null,
      }),
    );

    const saved = await this.repo.save(rows);
    const unreadByUser = new Map<string, number>();
    const dtos = saved.map((row) => {
      const dto = toDto(row);
      return { userId: row.userId, notification: dto };
    });

    for (const row of saved) {
      if (!unreadByUser.has(row.userId)) {
        unreadByUser.set(row.userId, await this.countUnread(row.userId));
      }
      const dto = toDto(row);
      userNotificationManager.publish({
        userId: row.userId,
        type: "NOTIFICATION_CREATED",
        unreadCount: unreadByUser.get(row.userId) ?? 0,
        notification: dto,
      });
    }

    void pushSubscriptionService.sendNotificationTargets(dtos).catch((error) => {
      logger.warn({ err: error }, "Web push fan-out failed");
    });

    return dtos.map((row) => row.notification);
  }

  async listForUser(
    userId: string,
    options: {
      limit?: number;
      unreadOnly?: boolean;
      cursor?: string | null;
      type?: string | null;
    } = {},
  ) {
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 30));
    const qb = this.repo
      .createQueryBuilder("n")
      .where("n.userId = :userId", { userId })
      .orderBy("n.createdAt", "DESC")
      .addOrderBy("n.id", "DESC")
      .take(limit + 1);

    if (options.unreadOnly) {
      qb.andWhere("n.readAt IS NULL");
    }

    if (options.type && options.type.trim()) {
      qb.andWhere("n.type = :type", { type: options.type.trim() });
    }

    if (options.cursor && options.cursor.trim()) {
      const cursorDate = new Date(options.cursor.trim());
      if (!isNaN(cursorDate.getTime())) {
        qb.andWhere("n.createdAt < :cursorDate", { cursorDate });
      }
    }

    const [rows, unreadCount] = await Promise.all([
      qb.getMany(),
      this.countUnread(userId),
    ]);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && items.length > 0
        ? items[items.length - 1]!.createdAt.toISOString()
        : null;

    return {
      notifications: items.map(toDto),
      unreadCount,
      nextCursor,
      hasMore,
    };
  }

  async countUnread(userId: string): Promise<number> {
    return this.repo.count({ where: { userId, readAt: IsNull() } });
  }

  async markRead(userId: string, notificationId: string) {
    const row = await this.repo.findOne({
      where: { id: notificationId, userId },
    });
    if (!row) {
      throw new AppError(404, "Notification not found", "NOTIFICATION_NOT_FOUND");
    }
    if (!row.readAt) {
      row.readAt = new Date();
      await this.repo.save(row);
    }
    const unreadCount = await this.countUnread(userId);
    const dto = toDto(row);
    userNotificationManager.publish({
      userId,
      type: "NOTIFICATION_READ",
      unreadCount,
      notification: dto,
    });
    return { notification: dto, unreadCount };
  }

  async markAllRead(userId: string) {
    await this.repo
      .createQueryBuilder()
      .update(Notification)
      .set({ readAt: () => "NOW()" })
      .where('"userId" = :userId', { userId })
      .andWhere('"readAt" IS NULL')
      .execute();

    userNotificationManager.publish({
      userId,
      type: "UNREAD_COUNT",
      unreadCount: 0,
    });

    return { unreadCount: 0 };
  }
}

export const notificationsService = new NotificationsService();
