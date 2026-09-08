import type { NextFunction, Request, Response } from "express";
import { adminAiService } from "./admin-ai.service.js";

class AdminAiController {
  listThreads = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cursor =
        typeof req.query.cursor === "string" ? req.query.cursor : null;
      const data = await adminAiService.listThreads(req.user!.id, cursor);
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  createThread = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminAiService.createThread(req.user!.id);
      res.status(201).json(data);
    } catch (error) {
      next(error);
    }
  };

  getThread = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminAiService.getThread(
        req.user!.id,
        req.params.threadId as string,
      );
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  deleteThread = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminAiService.deleteThread(
        req.user!.id,
        req.params.threadId as string,
      );
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  sendMessage = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminAiService.sendMessage(req.user!.id, {
        content: String(req.body.content ?? ""),
        threadId: req.body.threadId ?? null,
      });
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };
}

export const adminAiController = new AdminAiController();
