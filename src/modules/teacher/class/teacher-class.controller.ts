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
}

export const teacherClassController = new TeacherClassController();
