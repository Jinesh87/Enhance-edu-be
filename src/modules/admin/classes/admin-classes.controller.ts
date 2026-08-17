import type { NextFunction, Request, Response } from "express";
import { adminClassesService } from "./admin-classes.service.js";

class AdminClassesController {
  list = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const classes = await adminClassesService.list();
      res.status(200).json({ classes });
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
      );
      res.status(201).json({ classes });
    } catch (error) {
      next(error);
    }
  };
}

export const adminClassesController = new AdminClassesController();
