import type { NextFunction, Request, Response } from "express";
import { adminExpensesService } from "./admin-expenses.service.js";

class AdminExpensesController {
  feature = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(200).json(await adminExpensesService.getFeatureFlag());
    } catch (error) {
      next(error);
    }
  };

  overview = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminExpensesService.overview({
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
      });
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  createFixed = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminExpensesService.createFixed(req.body, req.user?.id);
      res.status(201).json(data);
    } catch (error) {
      next(error);
    }
  };

  updateFixed = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminExpensesService.updateFixed(
        String(req.params.id),
        req.body,
      );
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  deleteFixed = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res
        .status(200)
        .json(await adminExpensesService.deleteFixed(String(req.params.id)));
    } catch (error) {
      next(error);
    }
  };

  createVariable = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminExpensesService.createVariable(
        req.body,
        req.user?.id,
      );
      res.status(201).json(data);
    } catch (error) {
      next(error);
    }
  };

  updateVariable = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminExpensesService.updateVariable(
        String(req.params.id),
        req.body,
      );
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  deleteVariable = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res
        .status(200)
        .json(await adminExpensesService.deleteVariable(String(req.params.id)));
    } catch (error) {
      next(error);
    }
  };
}

export const adminExpensesController = new AdminExpensesController();
