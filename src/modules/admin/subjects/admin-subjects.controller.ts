import type { NextFunction, Request, Response } from "express";
import { adminSubjectsService } from "./admin-subjects.service.js";

class AdminSubjectsController {
  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = req.query.page ? Number(req.query.page) : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const { subjects, total, recentlyAddedCount } = await adminSubjectsService.list({ page, limit });
      res.status(200).json({ subjects, total, recentlyAddedCount });
    } catch (error) {
      next(error);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const subject = await adminSubjectsService.create(
        req.body.name,
        req.body.yearLevelId,
      );
      res.status(201).json({ subject });
    } catch (error) {
      next(error);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const subject = await adminSubjectsService.update(
        req.params.id as string,
        req.body.name,
        req.body.yearLevelId,
      );
      res.status(200).json({ subject });
    } catch (error) {
      next(error);
    }
  };

  remove = async (req: Request, res: Response, next: NextFunction) => {
    try {
      await adminSubjectsService.remove(req.params.id as string);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };
}

export const adminSubjectsController = new AdminSubjectsController();
