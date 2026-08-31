import { NextFunction, Request, Response } from "express";
import { sharedAttendanceService } from "../../shared/attendance/shared-attendance.service.js";
import { adminAttendanceService } from "./admin-attendance.service.js";
import { liveUpdateManager } from "../../shared/attendance/live-updates.js";
import { AdminDecision } from "../../../entities/index.js";
import { AppError } from "../../../common/errors/AppError.js";

class AdminAttendanceController {
  async listExceptions(req: Request, res: Response, next: NextFunction) {
    try {
      const year = req.query.year ? Number(req.query.year) : undefined;
      const yearLevel =
        typeof req.query.yearLevel === "string" && req.query.yearLevel.trim()
          ? req.query.yearLevel.trim()
          : undefined;
      if (
        typeof year !== "number" ||
        !Number.isInteger(year) ||
        !yearLevel
      ) {
        throw new AppError(
          400,
          "Academic year and year level are required",
          "ATTENDANCE_SCOPE_REQUIRED",
        );
      }
      const pageExceptions = req.query.pageExceptions
        ? Number(req.query.pageExceptions)
        : undefined;
      const limitExceptions = req.query.limitExceptions
        ? Number(req.query.limitExceptions)
        : undefined;
      const pageAbsences = req.query.pageAbsences
        ? Number(req.query.pageAbsences)
        : undefined;
      const limitAbsences = req.query.limitAbsences
        ? Number(req.query.limitAbsences)
        : undefined;

      const data = await adminAttendanceService.getExceptionsAndAbsences({
        year,
        yearLevel,
        pageExceptions,
        limitExceptions,
        pageAbsences,
        limitAbsences,
      });
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  }

  async resolveException(req: Request, res: Response, next: NextFunction) {
    try {
      const scanEventId = req.params.id as string;
      const resolvedByUserId = req.user!.id;
      const { decision, reassignedSessionId } = req.body;

      if (!Object.values(AdminDecision).includes(decision)) {
        throw new AppError(
          400,
          "Invalid exception decision",
          "INVALID_DECISION",
        );
      }

      const result = await adminAttendanceService.resolveScanException(
        scanEventId,
        decision as AdminDecision,
        resolvedByUserId,
        reassignedSessionId,
      );

      try {
        if (result.scan && result.scan.sessionId) {
          const rollData = await sharedAttendanceService.getLiveRollData(
            result.scan.sessionId,
          );
          liveUpdateManager.broadcast(result.scan.sessionId, {
            type: "ROLL_UPDATE",
            ...rollData,
          });
        }
      } catch (err) {
        console.error(
          "Failed to broadcast exception resolution roll update:",
          err,
        );
      }

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async updateAbsenceFollowUp(req: Request, res: Response, next: NextFunction) {
    try {
      const absence = await adminAttendanceService.updateAbsenceFollowUp(
        req.params.id as string,
        {
          policy: req.body.policy,
          followUpStaffId: req.body.followUpStaffId,
        },
      );
      res.status(200).json({ absence });
    } catch (error) {
      next(error);
    }
  }

  async getAbsenceReviewDraft(req: Request, res: Response, next: NextFunction) {
    try {
      const draft = await adminAttendanceService.getAbsenceReviewDraft(
        req.params.id as string,
      );
      res.status(200).json(draft);
    } catch (error) {
      next(error);
    }
  }

  async reviewAndSendAbsence(req: Request, res: Response, next: NextFunction) {
    try {
      const absence = await adminAttendanceService.reviewAndSendAbsence(
        req.params.id as string,
        String(req.body.message ?? ""),
        req.user!.id,
      );
      res.status(200).json({ absence });
    } catch (error) {
      next(error);
    }
  }

  async listRecords(req: Request, res: Response, next: NextFunction) {
    try {
      const year = req.query.year ? Number(req.query.year) : undefined;
      const yearLevel =
        typeof req.query.yearLevel === "string" && req.query.yearLevel
          ? req.query.yearLevel
          : undefined;
      const term =
        typeof req.query.term === "string" && req.query.term
          ? req.query.term
          : undefined;
      const search =
        typeof req.query.search === "string" && req.query.search.trim()
          ? req.query.search.trim()
          : undefined;
      const page = req.query.page ? Number(req.query.page) : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;

      if (
        typeof year !== "number" ||
        !Number.isInteger(year) ||
        !yearLevel
      ) {
        throw new AppError(
          400,
          "Academic year and year level are required",
          "ATTENDANCE_SCOPE_REQUIRED",
        );
      }

      const data = await adminAttendanceService.listRecordsForCorrection({
        year,
        yearLevel,
        term,
        search,
        page,
        limit,
      });
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  }

  async correctRecord(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await adminAttendanceService.correctAttendanceRecord(
        req.params.id as string,
        req.body.status,
        String(req.body.reason ?? ""),
        req.user!.id,
      );

      try {
        if (result.record.sessionId) {
          const rollData = await sharedAttendanceService.getLiveRollData(
            result.record.sessionId,
          );
          liveUpdateManager.broadcast(result.record.sessionId, {
            type: "ROLL_UPDATE",
            ...rollData,
          });
        }
      } catch (err) {
        console.error("Failed to broadcast attendance correction roll update:", err);
      }

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async getCorrectionHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await adminAttendanceService.getCorrectionHistory(
        req.params.id as string,
      );
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  }
}

export const adminAttendanceController = new AdminAttendanceController();
