import type { NextFunction, Request, Response } from "express";
import { teacherCoachService } from "./teacher-coach.service.js";

class TeacherCoachController {
  getConversation = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const threadId =
        typeof req.query.threadId === "string" ? req.query.threadId : null;
      const data = await teacherCoachService.getConversation(
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
      const data = await teacherCoachService.listThreads(req.user!.id);
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  createThread = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await teacherCoachService.createThread(req.user!.id);
      res.status(201).json(data);
    } catch (error) {
      next(error);
    }
  };

  deleteThread = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await teacherCoachService.deleteThread(
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
      const data = await teacherCoachService.sendMessage(req.user!.id, {
        content: String(req.body.content ?? ""),
        threadId: req.body.threadId ?? null,
      });
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };
}

export const teacherCoachController = new TeacherCoachController();
