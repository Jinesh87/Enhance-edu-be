import type { NextFunction, Request, Response } from "express";
import { studentLearningService } from "./student-learning.service.js";

class StudentLearningController {
  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await studentLearningService.list(req.user!.id);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  getSet = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await studentLearningService.getSet(
        req.user!.id,
        req.params.setId as string,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  updateFlashcardProgress = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await studentLearningService.updateFlashcardProgress(
        req.user!.id,
        req.params.flashcardId as string,
        req.body.status,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  startAttempt = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await studentLearningService.startQuizAttempt(
        req.user!.id,
        req.params.setId as string,
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  completeAttempt = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await studentLearningService.completeQuizAttempt(
        req.user!.id,
        req.params.attemptId as string,
        req.body.answers,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  getAttemptResult = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await studentLearningService.getAttemptResult(
        req.user!.id,
        req.params.attemptId as string,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  leaderboard = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await studentLearningService.getLeaderboard(
        req.user!.id,
        req.params.setId as string,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const studentLearningController = new StudentLearningController();
