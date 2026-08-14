import type { NextFunction, Request, Response } from "express";
import { adminNotificationManager } from "./admin-task-updates.js";
import { adminTasksService } from "./admin-tasks.service.js";

class AdminTasksController {
  list = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminTasksService.list();
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  complete = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const task = await adminTasksService.complete(
        req.params.id as string,
        req.user!.id,
      );
      res.status(200).json({ task });
    } catch (error) {
      next(error);
    }
  };

  streamLiveUpdates = (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      res.write(": ok\n\n");

      adminNotificationManager.register(res);
    } catch (error) {
      next(error);
    }
  };
}

export const adminTasksController = new AdminTasksController();
