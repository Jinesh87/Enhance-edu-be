import { NextFunction, Request, Response } from "express";
import { adminAttendanceService } from "./admin-attendance.service.js";
import { sharedAttendanceService } from "../../shared/attendance/shared-attendance.service.js";
import { liveUpdateManager } from "../../shared/attendance/live-updates.js";

class AdminAttendanceController {
  async listExceptions(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await adminAttendanceService.getExceptionsAndAbsences();
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  }

  async resolveException(req: Request, res: Response, next: NextFunction) {
    try {
      const scanEventId = req.params.id as string;
      const resolvedByUserId = req.user!.id;
      const { decision } = req.body;
      const result = await adminAttendanceService.resolveScanException(
        scanEventId,
        decision,
        resolvedByUserId
      );

      try {
        if (result.scan && result.scan.sessionId) {
          const rollData = await sharedAttendanceService.getLiveRollData(result.scan.sessionId);
          liveUpdateManager.broadcast(result.scan.sessionId, { type: "ROLL_UPDATE", ...rollData });
        }
      } catch (err) {
        console.error("Failed to broadcast exception resolution roll update:", err);
      }

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export const adminAttendanceController = new AdminAttendanceController();
