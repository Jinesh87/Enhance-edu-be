import type { NextFunction, Request, Response } from "express";
import { adminClassesService } from "./admin-classes.service.js";

class AdminClassesController {
  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = req.query.page ? Number(req.query.page) : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const search = req.query.search ? String(req.query.search) : undefined;
      const year = req.query.year ? Number(req.query.year) : undefined;
      const yearLevel = req.query.yearLevel ? String(req.query.yearLevel) : undefined;
      const term = req.query.term ? String(req.query.term) : undefined;

      const { classes, summaries, total } = await adminClassesService.list({
        page,
        limit,
        search,
        year,
        yearLevel,
        term,
      });
      res.status(200).json({ classes, summaries, total });
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const classItem = await adminClassesService.getById(req.params.id as string);
      res.status(200).json({ class: classItem });
    } catch (error) {
      next(error);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const classItem = await adminClassesService.create(req.body);
      res.status(201).json({ class: classItem });
    } catch (error) {
      next(error);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const classItem = await adminClassesService.update(
        req.params.id as string,
        req.body,
      );
      res.status(200).json({ class: classItem });
    } catch (error) {
      next(error);
    }
  };

  remove = async (req: Request, res: Response, next: NextFunction) => {
    try {
      await adminClassesService.remove(req.params.id as string);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };

  bulkReplace = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const classes = await adminClassesService.bulkReplace(
        req.body.termId,
        req.body.classes,
        req.body.gracePeriodMinutes,
      );
      res.status(201).json({ classes });
    } catch (error) {
      next(error);
    }
  };
}

export const adminClassesController = new AdminClassesController();
