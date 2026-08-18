import type { NextFunction, Request, Response } from "express";
import { studentClassesService } from "./student-classes.service.js";

class StudentClassesController {
  getTimetable = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await studentClassesService.getTimetable(req.user!.id);
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  getLesson = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const lesson = await studentClassesService.getLesson(
        req.user!.id,
        req.params.sessionId as string,
      );
      res.status(200).json({ lesson });
    } catch (error) {
      next(error);
    }
  };
}

export const studentClassesController = new StudentClassesController();
