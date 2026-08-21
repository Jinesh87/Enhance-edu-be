import type { NextFunction, Request, Response } from "express";
import { guardianStudentsService } from "./guardian-students.service.js";

class GuardianStudentsController {
  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await guardianStudentsService.listForGuardian(
        req.user!.id,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  acceptPending = async (req: Request, res: Response, next: NextFunction) => {
    try {
      await guardianStudentsService.acceptPendingEnrollment(
        req.user!.id,
        req.params.id as string,
        req.body?.username && req.body?.password
          ? {
              username: req.body.username,
              password: req.body.password,
            }
          : undefined,
      );
      res.status(200).json({ accepted: true });
    } catch (error) {
      next(error);
    }
  };

  updatePassword = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await guardianStudentsService.updateStudentPassword(
        req.user!.id,
        req.params.studentId as string,
        req.body.password,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const guardianStudentsController = new GuardianStudentsController();
