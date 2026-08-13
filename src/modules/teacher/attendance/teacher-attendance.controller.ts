import { NextFunction, Request, Response } from "express";
import { teacherAttendanceService } from "./teacher-attendance.service.js";
import { sharedAttendanceService } from "../../shared/attendance/shared-attendance.service.js";
import { liveUpdateManager } from "../../shared/attendance/live-updates.js";

class TeacherAttendanceController {
  async getTeacherDashboard(req: Request, res: Response, next: NextFunction) {
    try {
      const teacherId = req.user!.id;
      const data = await teacherAttendanceService.getTeacherDashboardData(teacherId);
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  }

  async getQrCode(req: Request, res: Response, next: NextFunction) {
    try {
      const sessionId = req.params.id as string;
      const result = await teacherAttendanceService.generateSessionQrCode(sessionId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async getLiveRoll(req: Request, res: Response, next: NextFunction) {
    try {
      const sessionId = req.params.id as string;
      const result = await sharedAttendanceService.getLiveRollData(sessionId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async markManual(req: Request, res: Response, next: NextFunction) {
    try {
      const sessionId = req.params.id as string;
      const markedByUserId = req.user!.id;
      const { studentId, status, reason } = req.body;
      const record = await teacherAttendanceService.markManualRoll({
        sessionId,
        studentId,
        status,
        reason,
        markedByUserId,
      });

      try {
        const rollData = await sharedAttendanceService.getLiveRollData(sessionId);
        liveUpdateManager.broadcast(sessionId, { type: "ROLL_UPDATE", ...rollData });
      } catch (err) {
        console.error("Failed to broadcast manual roll update:", err);
      }

      res.status(200).json({ record });
    } catch (error) {
      next(error);
    }
  }

  async streamLiveUpdates(req: Request, res: Response, next: NextFunction) {
    try {
      const sessionId = req.params.id as string;

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      res.write(": ok\n\n");

      liveUpdateManager.register(sessionId, res);
    } catch (error) {
      next(error);
    }
  }
}

export const teacherAttendanceController = new TeacherAttendanceController();
