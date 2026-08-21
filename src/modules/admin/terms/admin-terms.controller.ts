import type { NextFunction, Request, Response } from "express";
import { writeAuditLog } from "../../../common/utils/audit-log.js";
import { adminTermsService } from "./admin-terms.service.js";

class AdminTermsController {
  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = req.query.page ? Number(req.query.page) : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const yearLevel = req.query.yearLevel ? String(req.query.yearLevel) : undefined;
      const year = req.query.year ? Number(req.query.year) : undefined;
      const search = req.query.search ? String(req.query.search) : undefined;
      const { terms, total } = await adminTermsService.list({ page, limit, yearLevel, year, search });
      res.status(200).json({ terms, total });
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
        isTrial: req.body.isTrial,
      });
      await writeAuditLog({
        actorUserId: req.user!.id,
        action: "CREATED",
        recordType: "term",
        recordId: term.id,
        recordLabel: term.name,
        after: {
          academicYear: term.academicYear?.year,
          yearLevel: term.yearLevel?.name,
          startDate: term.startDate,
          endDate: term.endDate,
          isTrial: term.isTrial,
        },
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
        isTrial: req.body.isTrial,
      });
      await writeAuditLog({
        actorUserId: req.user!.id,
        action: "EDITED",
        recordType: "term",
        recordId: term.id,
        recordLabel: term.name,
        after: {
          academicYear: term.academicYear?.year,
          yearLevel: term.yearLevel?.name,
          startDate: term.startDate,
          endDate: term.endDate,
          isTrial: term.isTrial,
        },
      });
      res.status(200).json({ term });
    } catch (error) {
      next(error);
    }
  };

  remove = async (req: Request, res: Response, next: NextFunction) => {
    try {
      await adminTermsService.remove(req.params.id as string);
      await writeAuditLog({
        actorUserId: req.user!.id,
        action: "DELETED",
        recordType: "term",
        recordId: req.params.id as string,
        recordLabel: req.params.id as string,
      });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };
}

export const adminTermsController = new AdminTermsController();
