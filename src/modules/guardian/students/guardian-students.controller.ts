import type { NextFunction, Request, Response } from "express";
import { guardianStudentsService } from "./guardian-students.service.js";

class GuardianStudentsController {
  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const students = await guardianStudentsService.listForGuardian(
        req.user!.id,
      );
      res.status(200).json({ students });
    } catch (error) {
      next(error);
    }
  };
}

export const guardianStudentsController = new GuardianStudentsController();
