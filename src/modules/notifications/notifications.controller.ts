import type { NextFunction, Request, Response } from "express";
import { notificationsService } from "./notifications.service.js";
import { userNotificationManager } from "./notification-updates.js";

class NotificationsController {
  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const unreadOnly =
        String(req.query.unreadOnly ?? "").toLowerCase() === "true";
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const data = await notificationsService.listForUser(req.user!.id, {
        limit,
        unreadOnly,
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
