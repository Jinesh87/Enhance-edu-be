import type { NextFunction, Request, Response } from "express";
import { writeAuditLog } from "../../../common/utils/audit-log.js";
import { adminEnrollmentsService } from "./admin-enrollments.service.js";

class AdminEnrollmentsController {
  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = req.query.page ? Number(req.query.page) : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const search = req.query.search ? String(req.query.search) : undefined;
      const termId = req.query.termId ? String(req.query.termId) : undefined;
      const term = req.query.term ? String(req.query.term) : undefined;
      const year = req.query.year ? Number(req.query.year) : undefined;
      const yearLevel = req.query.yearLevel ? String(req.query.yearLevel) : undefined;
      const status = req.query.status ? String(req.query.status) : undefined;

      const { enrollments, total, pendingGuardiansCount } = await adminEnrollmentsService.list({
        page,
        limit,
        search,
        termId,
        term,
        year: Number.isFinite(year) ? year : undefined,
        yearLevel,
        status,
      });
      res.status(200).json({ enrollments, total, pendingGuardiansCount });
    } catch (error) {
      next(error);
    }
  };

  invite = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await adminEnrollmentsService.inviteWithEnrollment(
        {
          guardianId: req.body.guardianId,
          guardian: req.body.guardian,
          student: req.body.student,
          enrollment: req.body.enrollment,
          studentLogin: req.body.studentLogin,
        },
        req.user!.id,
      );
      await writeAuditLog({
        actorUserId: req.user!.id,
        action: "CREATED",
        recordType: "enrolment",
        recordId: result.enrollment?.id ?? null,
        recordLabel: result.student?.fullName ?? "Enrolment",
        after: {
          guardian: result.guardian?.fullName ?? null,
          awaitingGuardianAcceptance: result.awaitingGuardianAcceptance,
        },
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const enrollment = await adminEnrollmentsService.getById(
        req.params.id as string,
      );
      res.status(200).json({ enrollment });
    } catch (error) {
      next(error);
    }
  };

  modify = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await adminEnrollmentsService.proposeModification(
        req.params.id as string,
        {
          student: req.body.student,
          enrollment: req.body.enrollment,
        },
        req.user!.id,
      );
      await writeAuditLog({
        actorUserId: req.user!.id,
        action: "EDITED",
        recordType: "enrolment",
        recordId: req.params.id as string,
        recordLabel: req.body.student?.fullName ?? "Enrolment",
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const adminEnrollmentsController = new AdminEnrollmentsController();
