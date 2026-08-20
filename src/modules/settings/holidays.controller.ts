import type { NextFunction, Request, Response } from "express";
import { writeAuditLog } from "../../common/utils/audit-log.js";
import type { HolidayKind } from "../../entities/index.js";
import { holidaysService } from "./holidays.service.js";

class HolidaysController {
  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const kind = req.query.kind
        ? (String(req.query.kind) as HolidayKind)
        : undefined;
      const termId = req.query.termId ? String(req.query.termId) : undefined;
      const holidays = await holidaysService.list({ kind, termId });
      res.status(200).json({ holidays });
    } catch (error) {
      next(error);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const holiday = await holidaysService.create({
        name: req.body.name,
        kind: req.body.kind,
        termId: req.body.termId ?? null,
        startDate: req.body.startDate,
        endDate: req.body.endDate,
      });
      await writeAuditLog({
        actorUserId: req.user!.id,
        action: "CREATED",
        recordType: "holiday",
        recordId: holiday.id,
        recordLabel: holiday.name,
        after: {
          kind: holiday.kind,
          termId: holiday.term?.id ?? null,
          startDate: holiday.startDate,
          endDate: holiday.endDate,
        },
      });
      res.status(201).json({ holiday });
    } catch (error) {
      next(error);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const holiday = await holidaysService.update(req.params.id as string, {
        name: req.body.name,
        kind: req.body.kind,
        termId: req.body.termId ?? null,
        startDate: req.body.startDate,
        endDate: req.body.endDate,
      });
      await writeAuditLog({
        actorUserId: req.user!.id,
        action: "EDITED",
        recordType: "holiday",
        recordId: holiday.id,
        recordLabel: holiday.name,
        after: {
          kind: holiday.kind,
          termId: holiday.term?.id ?? null,
          startDate: holiday.startDate,
          endDate: holiday.endDate,
        },
      });
      res.status(200).json({ holiday });
    } catch (error) {
      next(error);
    }
  };

  remove = async (req: Request, res: Response, next: NextFunction) => {
    try {
      await holidaysService.remove(req.params.id as string);
      await writeAuditLog({
        actorUserId: req.user!.id,
        action: "DELETED",
        recordType: "holiday",
        recordId: req.params.id as string,
        recordLabel: req.params.id as string,
      });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };
}

export const holidaysController = new HolidaysController();
