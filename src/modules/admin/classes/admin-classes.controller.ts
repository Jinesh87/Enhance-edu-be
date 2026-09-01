import type { NextFunction, Request, Response } from "express";
import { writeAuditLog } from "../../../common/utils/audit-log.js";
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
      res.setHeader("Cache-Control", "no-store");
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

  listEnrolledStudents = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { students } = await adminClassesService.listEnrolledStudents(
        req.params.id as string,
      );
      res.status(200).json({ students });
    } catch (error) {
      next(error);
    }
  };

  listGroupSessions = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = req.query as unknown as {
        subject: string;
        term: string;
        page?: number;
        limit?: number;
        status?: "ALL" | "UPCOMING" | "LIVE" | "ENDED" | "SCHEDULED";
        search?: string | null;
        startDate?: string | null;
        endDate?: string | null;
      };
      const data = await adminClassesService.listGroupSessions(
        query.subject,
        query.term,
        {
          page: query.page,
          limit: query.limit,
          status: query.status,
          search: query.search ?? "",
          startDate: query.startDate ?? "",
          endDate: query.endDate ?? "",
        },
      );
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  listCalendarSessions = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const year = req.query.year ? Number(req.query.year) : undefined;
      const term = req.query.term ? String(req.query.term) : undefined;
      const data = await adminClassesService.listCalendarSessions({ year, term });
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  updateSession = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await adminClassesService.updateSession(
        req.params.id as string,
        req.body,
      );
      await writeAuditLog({
        actorUserId: req.user!.id,
        action: "EDITED",
        recordType: "session",
        recordId: session.id,
        recordLabel: session.class?.subject || session.class?.name || "Session",
        after: {
          startAt: session.startAt,
          endAt: session.endAt,
          room: session.room,
          teacherId: session.class?.teacher?.id ?? null,
          gracePeriodMinutes: session.gracePeriodMinutes,
        },
      });
      res.status(200).json({ session });
    } catch (error) {
      next(error);
    }
  };

  removeSession = async (req: Request, res: Response, next: NextFunction) => {
    try {
      await adminClassesService.removeSession(req.params.id as string);
      await writeAuditLog({
        actorUserId: req.user!.id,
        action: "DELETED",
        recordType: "session",
        recordId: req.params.id as string,
        recordLabel: "Session",
      });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };

  bulkRemoveSessions = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { ids } = req.body as { ids: string[] };
      const result = await adminClassesService.removeSessions(ids);
      for (const sessionId of result.deletedIds) {
        await writeAuditLog({
          actorUserId: req.user!.id,
          action: "DELETED",
          recordType: "session",
          recordId: sessionId,
          recordLabel: "Session",
        });
      }
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const classItem = await adminClassesService.create(req.body);
      await writeAuditLog({
        actorUserId: req.user!.id,
        action: "CREATED",
        recordType: "class",
        recordId: classItem.id,
        recordLabel: classItem.subject || classItem.name,
        after: {
          code: classItem.code,
          dayTime: classItem.dayTime,
          room: classItem.room,
        },
      });
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
      await writeAuditLog({
        actorUserId: req.user!.id,
        action: "EDITED",
        recordType: "class",
        recordId: classItem.id,
        recordLabel: classItem.subject || classItem.name,
        after: {
          code: classItem.code,
          dayTime: classItem.dayTime,
          room: classItem.room,
        },
      });
      res.status(200).json({ class: classItem });
    } catch (error) {
      next(error);
    }
  };

  remove = async (req: Request, res: Response, next: NextFunction) => {
    try {
      await adminClassesService.remove(req.params.id as string);
      await writeAuditLog({
        actorUserId: req.user!.id,
        action: "DELETED",
        recordType: "class",
        recordId: req.params.id as string,
        recordLabel: req.params.id as string,
      });
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
      await writeAuditLog({
        actorUserId: req.user!.id,
        action: "EDITED",
        recordType: "class",
        recordId: req.body.termId,
        recordLabel: `Timetable · ${classes.length} sessions`,
        after: { sessionCount: classes.length, termId: req.body.termId },
      });
      res.status(201).json({ classes });
    } catch (error) {
      next(error);
    }
  };
}

export const adminClassesController = new AdminClassesController();
