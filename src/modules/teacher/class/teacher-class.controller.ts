import { NextFunction, Request, Response } from "express";
import { teacherClassService } from "./teacher-class.service.js";

class TeacherClassController {
  async getTeacherDashboard(req: Request, res: Response, next: NextFunction) {
    try {
      const teacherId = req.user!.id;
      const data = await teacherClassService.getTeacherDashboardData(teacherId);
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  }

  async getTeacherSessionSubjects(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const teacherId = req.user!.id;
      const data = await teacherClassService.getTeacherSubjects(teacherId);
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  }

  async listUpcomingSessions(req: Request, res: Response, next: NextFunction) {
    try {
      const teacherId = req.user!.id;
      const data = await teacherClassService.listUpcomingSessions(teacherId, {
        subject: req.query.subject as string | undefined,
        range: (req.query.range as "initial" | "week") ?? "initial",
        weekStart: req.query.weekStart as string | undefined,
      });
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  }

  async listPastSessions(req: Request, res: Response, next: NextFunction) {
    try {
      const teacherId = req.user!.id;
      const data = await teacherClassService.listPastSessions(teacherId, {
        subject: req.query.subject as string | undefined,
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 15,
      });
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  }

  async getSessionDetail(req: Request, res: Response, next: NextFunction) {
    try {
      const teacherId = req.user!.id;
      const data = await teacherClassService.getSessionDetail(
        teacherId,
        String(req.params.sessionId),
      );
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  }
}

export const teacherClassController = new TeacherClassController();
