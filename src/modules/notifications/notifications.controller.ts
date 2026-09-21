import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/errors/AppError.js";
import { notificationsService } from "./notifications.service.js";
import { userNotificationManager } from "./notification-updates.js";
import {
  getVapidPublicKey,
  isWebPushConfigured,
  pushSubscriptionService,
} from "./push.service.js";

class NotificationsController {
  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const unreadOnly =
        String(req.query.unreadOnly ?? "").toLowerCase() === "true";
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const cursor =
        typeof req.query.cursor === "string" ? req.query.cursor : undefined;
      const type =
        typeof req.query.type === "string" ? req.query.type : undefined;
      const data = await notificationsService.listForUser(req.user!.id, {
        limit,
        unreadOnly,
        cursor,
        type,
      });
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  unreadCount = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const unreadCount = await notificationsService.countUnread(req.user!.id);
      res.status(200).json({ unreadCount });
    } catch (error) {
      next(error);
    }
  };

  markRead = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await notificationsService.markRead(
        req.user!.id,
        req.params.id as string,
      );
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  markAllRead = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await notificationsService.markAllRead(req.user!.id);
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  vapidPublicKey = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      if (!isWebPushConfigured()) {
        throw new AppError(
          503,
          "Web Push is not configured",
          "WEB_PUSH_NOT_CONFIGURED",
        );
      }
      const publicKey = getVapidPublicKey();
      res.status(200).json({ publicKey, configured: Boolean(publicKey) });
    } catch (error) {
      next(error);
    }
  };

  subscribePush = async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!isWebPushConfigured()) {
        throw new AppError(
          503,
          "Web Push is not configured",
          "WEB_PUSH_NOT_CONFIGURED",
        );
      }
      const { endpoint, keys, userAgent } = req.body as {
        endpoint: string;
        keys: { p256dh: string; auth: string };
        userAgent?: string | null;
      };
      await pushSubscriptionService.upsert(req.user!.id, {
        endpoint,
        keys,
        userAgent:
          typeof userAgent === "string"
            ? userAgent
            : (req.get("user-agent") ?? null),
      });
      res.status(200).json({ ok: true });
    } catch (error) {
      next(error);
    }
  };

  unsubscribePush = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { endpoint } = req.body as { endpoint: string };
      const removed = await pushSubscriptionService.remove(
        req.user!.id,
        endpoint,
      );
      res.status(200).json({ ok: true, removed });
    } catch (error) {
      next(error);
    }
  };

  stream = (req: Request, res: Response, next: NextFunction) => {
    try {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      res.write(": ok\n\n");
      userNotificationManager.register(req.user!.id, res);

      void notificationsService.countUnread(req.user!.id).then((unreadCount) => {
        try {
          res.write(
            `data: ${JSON.stringify({
              userId: req.user!.id,
              type: "UNREAD_COUNT",
              unreadCount,
            })}\n\n`,
          );
        } catch {
          // Client may have disconnected.
        }
      });
    } catch (error) {
      next(error);
    }
  };
}

export const notificationsController = new NotificationsController();
