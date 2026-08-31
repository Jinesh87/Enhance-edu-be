import type { NextFunction, Request, Response } from "express";
import { guardianAcademicsService } from "./guardian-academics.service.js";

class GuardianAcademicsController {
  getTimetable = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await guardianAcademicsService.getTimetable(
        req.user!.id,
        req.params.studentId as string,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  getLesson = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await guardianAcademicsService.getLesson(
        req.user!.id,
        req.params.studentId as string,
        req.params.sessionId as string,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  getAssessmentSubmission = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await guardianAcademicsService.getAssessmentSubmission(
        req.user!.id,
        req.params.studentId as string,
        req.params.assessmentId as string,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  listEntranceExams = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await guardianAcademicsService.listEntranceExams(
        req.user!.id,
        req.params.studentId as string,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  getEntranceExamSubmission = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await guardianAcademicsService.getEntranceExamSubmission(
        req.user!.id,
        req.params.studentId as string,
        req.params.assessmentId as string,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  getAttendance = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await guardianAcademicsService.getAttendance(
        req.user!.id,
        req.params.studentId as string,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const guardianAcademicsController = new GuardianAcademicsController();
