import type { NextFunction, Request, Response } from "express";
import { writeAuditLog } from "../../../common/utils/audit-log.js";
import { adminAssessmentsService } from "./admin-assessments.service.js";

class AdminAssessmentsController {
  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = req.query.page ? Number(req.query.page) : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const search = req.query.search ? String(req.query.search) : undefined;
      const termId = req.query.termId ? String(req.query.termId) : undefined;
      const subject = req.query.subject ? String(req.query.subject) : undefined;
      const yearGroup = req.query.yearGroup
        ? String(req.query.yearGroup)
        : undefined;
      const status = req.query.status
        ? (String(req.query.status) as
            | "SCHEDULED"
            | "COMPLETED"
            | "CANCELLED"
            | "ARCHIVED"
            | "ACTIVE")
        : undefined;
      const { assessments, total } = await adminAssessmentsService.list({
        page,
        limit,
        search,
        termId,
        subject,
        yearGroup,
        status,
      });
      res.status(200).json({ assessments, total });
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const assessment = await adminAssessmentsService.getById(
        req.params.id as string,
      );
      res.status(200).json({ assessment });
    } catch (error) {
      next(error);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const assessment = await adminAssessmentsService.create(req.body);
      await writeAuditLog({
        actorUserId: req.user!.id,
        action: "CREATED",
        recordType: "assessment",
        recordId: assessment.id,
        recordLabel: assessment.name,
        after: {
          subject: assessment.subject,
          assessmentDate: assessment.assessmentDate,
          studentCount: assessment.studentCount,
        },
      });
      res.status(201).json({ assessment });
    } catch (error) {
      next(error);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const assessment = await adminAssessmentsService.update(
        req.params.id as string,
        req.body,
      );
      await writeAuditLog({
        actorUserId: req.user!.id,
        action: "EDITED",
        recordType: "assessment",
        recordId: assessment.id,
        recordLabel: assessment.name,
        after: {
          subject: assessment.subject,
          assessmentDate: assessment.assessmentDate,
          studentCount: assessment.studentCount,
        },
      });
      res.status(200).json({ assessment });
    } catch (error) {
      next(error);
    }
  };

  archive = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const assessment = await adminAssessmentsService.archive(
        req.params.id as string,
      );
      await writeAuditLog({
        actorUserId: req.user!.id,
        action: "DELETED",
        recordType: "assessment",
        recordId: assessment.id,
        recordLabel: assessment.name,
      });
      res.status(200).json({ assessment });
    } catch (error) {
      next(error);
    }
  };

  remove = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const existing = await adminAssessmentsService.getById(id);
      await adminAssessmentsService.remove(id);
      await writeAuditLog({
        actorUserId: req.user!.id,
        action: "DELETED",
        recordType: "assessment",
        recordId: existing.id,
        recordLabel: existing.name,
      });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };
}

export const adminAssessmentsController = new AdminAssessmentsController();
