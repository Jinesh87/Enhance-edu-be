import type { NextFunction, Request, Response } from "express";
import { guardianCoachService } from "./guardian-coach.service.js";

class GuardianCoachController {
  getConversation = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const threadId =
        typeof req.query.threadId === "string" ? req.query.threadId : null;
      const data = await guardianCoachService.getConversation(
        req.user!.id,
        threadId,
      );
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  listThreads = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await guardianCoachService.listThreads(req.user!.id);
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  createThread = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await guardianCoachService.createThread(req.user!.id);
      res.status(201).json(data);
    } catch (error) {
      next(error);
    }
  };

  deleteThread = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await guardianCoachService.deleteThread(
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
      const data = await guardianCoachService.sendMessage(req.user!.id, {
        content: String(req.body.content ?? ""),
        threadId: req.body.threadId ?? null,
      });
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };
}

export const guardianCoachController = new GuardianCoachController();
