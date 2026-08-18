import type { NextFunction, Request, Response } from "express";
import { adminEnrollmentsService } from "./admin-enrollments.service.js";

class AdminEnrollmentsController {
  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = req.query.page ? Number(req.query.page) : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const search = req.query.search ? String(req.query.search) : undefined;

      const { enrollments, total, pendingGuardiansCount } = await adminEnrollmentsService.list({
        page,
        limit,
        search,
      });
      res.status(200).json({ enrollments, total, pendingGuardiansCount });
    } catch (error) {
      next(error);
    }
  };

  invite = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await adminEnrollmentsService.inviteWithEnrollment(
        {
          guardianId: req.body.guardianId,
          guardian: req.body.guardian,
          student: req.body.student,
          enrollment: req.body.enrollment,
          studentLogin: req.body.studentLogin,
        },
        req.user!.id,
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const enrollment = await adminEnrollmentsService.getById(
        req.params.id as string,
      );
      res.status(200).json({ enrollment });
    } catch (error) {
      next(error);
    }
  };

  modify = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await adminEnrollmentsService.proposeModification(
        req.params.id as string,
        {
          student: req.body.student,
          enrollment: req.body.enrollment,
        },
        req.user!.id,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const adminEnrollmentsController = new AdminEnrollmentsController();
