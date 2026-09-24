import type { NextFunction, Request, Response } from "express";
import { PayrollPayBasis } from "../../../entities/TeacherPayrollConfig.js";
import { adminPayrollService } from "./admin-payroll.service.js";

class AdminPayrollController {
  feature = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(200).json(await adminPayrollService.getFeatureFlag());
    } catch (error) {
      next(error);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminPayrollService.list({
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
      });
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  detail = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminPayrollService.getTeacherDetail(
        String(req.params.teacherUserId),
        {
          from: req.query.from ? String(req.query.from) : undefined,
          to: req.query.to ? String(req.query.to) : undefined,
        },
      );
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  upsertConfig = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminPayrollService.upsertConfig({
        teacherUserId: String(req.body.teacherUserId),
        payBasis: String(req.body.payBasis) as PayrollPayBasis,
        rate: Number(req.body.rate),
        currency: req.body.currency ? String(req.body.currency) : undefined,
        isActive:
          typeof req.body.isActive === "boolean"
            ? req.body.isActive
            : undefined,
        effectiveFrom: req.body.effectiveFrom
          ? String(req.body.effectiveFrom)
          : undefined,
      });
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };
}

export const adminPayrollController = new AdminPayrollController();
