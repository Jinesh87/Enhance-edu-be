import type { NextFunction, Request, Response } from "express";
import { adminTermsService } from "./admin-terms.service.js";

class AdminTermsController {
  list = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const terms = await adminTermsService.list();
      res.status(200).json({ terms });
    } catch (error) {
      next(error);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const term = await adminTermsService.create({
        name: req.body.name,
        academicYear: req.body.academicYear,
        yearLevel: req.body.yearLevel,
        startDate: req.body.startDate,
        endDate: req.body.endDate,
      });
      res.status(201).json({ term });
    } catch (error) {
      next(error);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const term = await adminTermsService.update(req.params.id as string, {
        name: req.body.name,
        academicYear: req.body.academicYear,
        yearLevel: req.body.yearLevel,
        startDate: req.body.startDate,
        endDate: req.body.endDate,
      });
      res.status(200).json({ term });
    } catch (error) {
      next(error);
    }
  };

  remove = async (req: Request, res: Response, next: NextFunction) => {
    try {
      await adminTermsService.remove(req.params.id as string);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };
}

export const adminTermsController = new AdminTermsController();
