import type { NextFunction, Request, Response } from "express";
import { studentCoachService } from "./student-coach.service.js";

class StudentCoachController {
  getConversation = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await studentCoachService.getConversation(req.user!.id);
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  listThreads = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await studentCoachService.listThreads(req.user!.id);
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  createThread = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await studentCoachService.createThread(req.user!.id);
      res.status(201).json(data);
    } catch (error) {
      next(error);
    }
  };

  sendMessage = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await studentCoachService.sendMessage(req.user!.id, {
        content: String(req.body.content ?? ""),
        threadId: req.body.threadId ?? null,
      });
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };
}

export const studentCoachController = new StudentCoachController();
