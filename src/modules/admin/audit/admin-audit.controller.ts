import type { NextFunction, Request, Response } from "express";
import type { AuditAction } from "../../../entities/AuditChange.js";
import { adminAuditService } from "./admin-audit.service.js";

function filtersFromQuery(req: Request) {
  const str = (key: string) => {
    const value = req.query[key];
    if (typeof value !== "string" || !value.trim()) return undefined;
    return value;
  };
  return {
    page: req.query.page ? Number(req.query.page) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    actor: str("actor"),
    recordType: str("recordType"),
    record: str("record"),
    action: str("action") as AuditAction | undefined,
    from: str("from"),
    to: str("to"),
    search: str("search"),
  };
}

class AdminAuditController {
  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await adminAuditService.list(filtersFromQuery(req));
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  exportCsv = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await adminAuditService.exportCsv(
        filtersFromQuery(req),
        req.user!.id,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const adminAuditController = new AdminAuditController();
