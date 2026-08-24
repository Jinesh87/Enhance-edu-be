import type { NextFunction, Request, Response } from "express";
import { writeAuditLog } from "../../../common/utils/audit-log.js";
import { adminEnquiriesService } from "./admin-enquiries.service.js";

function labelFor(enquiry: { studentFullName?: string | null; guardianFullName?: string }) {
  return enquiry.studentFullName || enquiry.guardianFullName || "Enquiry";
}

function listFiltersFromQuery(query: Request["query"]) {
  return {
    page: query.page ? Number(query.page) : undefined,
    limit: query.limit ? Number(query.limit) : undefined,
    search: query.search ? String(query.search) : undefined,
    stageId: query.stageId ? String(query.stageId) : undefined,
    ownerUserId: query.ownerUserId ? String(query.ownerUserId) : undefined,
    sourceId: query.sourceId ? String(query.sourceId) : undefined,
    status: query.status ? String(query.status) : undefined,
    idleDays: query.idleDays ? Number(query.idleDays) : undefined,
    yearLevel: query.yearLevel ? Number(query.yearLevel) : undefined,
    termId: query.termId ? String(query.termId) : undefined,
    subject: query.subject ? String(query.subject) : undefined,
    sort: query.sort ? String(query.sort) : undefined,
  };
}

class AdminEnquiriesController {
  meta = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(200).json(await adminEnquiriesService.meta());
    } catch (error) {
      next(error);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminEnquiriesService.list(listFiltersFromQuery(req.query));
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  board = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminEnquiriesService.board(listFiltersFromQuery(req.query));
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const enquiry = await adminEnquiriesService.getById(req.params.id as string);
      res.status(200).json({ enquiry });
    } catch (error) {
      next(error);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const enquiry = await adminEnquiriesService.create(req.body, req.user!.id);
      await writeAuditLog({
        actorUserId: req.user!.id,
        action: "CREATED",
        recordType: "enquiry",
        recordId: enquiry.id,
        recordLabel: labelFor(enquiry),
        after: {
          firstSource: enquiry.firstSource?.name ?? null,
          stage: enquiry.stage?.name ?? null,
        },
      });
      res.status(201).json({ enquiry });
    } catch (error) {
      next(error);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const enquiry = await adminEnquiriesService.update(
        req.params.id as string,
        req.body,
        req.user!.id,
      );
      await writeAuditLog({
        actorUserId: req.user!.id,
        action: "EDITED",
        recordType: "enquiry",
        recordId: enquiry.id,
        recordLabel: labelFor(enquiry),
      });
      res.status(200).json({ enquiry });
    } catch (error) {
      next(error);
    }
  };

  changeStage = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const enquiry = await adminEnquiriesService.changeStage(
        req.params.id as string,
        req.body,
        req.user!.id,
      );
      await writeAuditLog({
        actorUserId: req.user!.id,
        action: enquiry.stage?.kind === "LOST" ? "DENIED" : "EDITED",
        recordType: "enquiry",
        recordId: enquiry.id,
        recordLabel: labelFor(enquiry),
        after: { stage: enquiry.stage?.name ?? null },
      });
      res.status(200).json({ enquiry });
    } catch (error) {
      next(error);
    }
  };

  bookTrial = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const enquiry = await adminEnquiriesService.bookTrial(
        req.params.id as string,
        req.body,
        req.user!.id,
      );
      res.status(200).json({ enquiry });
    } catch (error) {
      next(error);
    }
  };

  trialAttendance = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const enquiry = await adminEnquiriesService.recordTrialAttendance(
        req.params.id as string,
        Boolean(req.body.attended),
        req.user!.id,
      );
      res.status(200).json({ enquiry });
    } catch (error) {
      next(error);
    }
  };

  exam = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const enquiry = await adminEnquiriesService.recordExam(
        req.params.id as string,
        req.body,
        req.user!.id,
      );
      res.status(200).json({ enquiry });
    } catch (error) {
      next(error);
    }
  };

  offer = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const enquiry = await adminEnquiriesService.issueOffer(
        req.params.id as string,
        req.user!.id,
      );
      res.status(200).json({ enquiry });
    } catch (error) {
      next(error);
    }
  };

  reject = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await adminEnquiriesService.rejectExam(
        req.params.id as string,
        req.user!.id,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  convert = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await adminEnquiriesService.convert(
        req.params.id as string,
        req.body,
        req.user!.id,
      );
      await writeAuditLog({
        actorUserId: req.user!.id,
        action: "APPROVED",
        recordType: "enquiry",
        recordId: result.enquiry.id,
        recordLabel: labelFor(result.enquiry),
        after: {
          enrollmentId: result.enrollment?.id ?? null,
        },
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  bulk = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await adminEnquiriesService.bulk(req.body, req.user!.id);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const adminEnquiriesController = new AdminEnquiriesController();
