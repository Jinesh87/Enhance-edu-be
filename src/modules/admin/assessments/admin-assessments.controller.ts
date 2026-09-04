import type { NextFunction, Request, Response } from "express";
import { respondWithStoredFile } from "../../../common/storage/object-storage.js";
import { writeAuditLog } from "../../../common/utils/audit-log.js";
import { adminAssessmentsService } from "./admin-assessments.service.js";

class AdminAssessmentsController {
  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = req.query as {
        page?: number;
        limit?: number;
        search?: string;
        termId?: string;
        term?: string;
        subject?: string;
        year?: number;
        yearGroup?: string;
        teacherId?: string;
        fromDate?: string;
        toDate?: string;
        kind?: "SCHOOL" | "ENTRANCE" | "ALL";
        status?:
          | "SCHEDULED"
          | "LIVE"
          | "COMPLETED"
          | "CANCELLED"
          | "ARCHIVED"
          | "ACTIVE"
          | "OPEN";
        includeStudents?: boolean;
        summaryOnly?: boolean;
      };

      const { assessments, total } = await adminAssessmentsService.list({
        page: query.page,
        limit: query.limit,
        search: query.search,
        termId: query.termId,
        term: query.term,
        subject: query.subject,
        year: query.year,
        yearGroup: query.yearGroup,
        teacherId: query.teacherId,
        fromDate: query.fromDate,
        toDate: query.toDate,
        kind: query.kind,
        status: query.status,
        includeStudents: query.includeStudents,
        summaryOnly: query.summaryOnly === true,
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

  listAttendees = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminAssessmentsService.listAttendees(
        req.params.id as string,
      );
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  getAttendeeSubmission = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const data = await adminAssessmentsService.getAttendeeSubmission(
        req.params.id as string,
        req.params.studentId as string,
      );
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  getAttendeeFile = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const file = await adminAssessmentsService.getAttendeeFile(
        req.params.id as string,
        req.params.studentId as string,
        req.params.fileId as string,
      );
      await respondWithStoredFile(res, {
        storageKey: file.storageKey,
        mimeType: file.mimeType,
        originalName: file.originalName,
      });
    } catch (error) {
      next(error);
    }
  };

  markAttendee = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminAssessmentsService.markAttendeeSubmission(
        req.params.id as string,
        req.params.studentId as string,
        req.body,
        {
          id: req.user!.id,
          role: req.user!.role,
        },
      );
      await writeAuditLog({
        actorUserId: req.user!.id,
        action: "EDITED",
        recordType: "assessment_submission",
        recordId: data.submission.id,
        recordLabel: `${data.assessment.name} · ${data.student.fullName}`,
        after: {
          mark: data.submission.mark,
          outcome: data.submission.outcome,
        },
      });
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };
}

export const adminAssessmentsController = new AdminAssessmentsController();
