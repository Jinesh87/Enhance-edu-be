import { NextFunction, Request, Response } from "express";
import { studentAttendanceService } from "./student-attendance.service.js";
import { sharedAttendanceService } from "../../shared/attendance/shared-attendance.service.js";
import { liveUpdateManager } from "../../shared/attendance/live-updates.js";

class StudentAttendanceController {
  async getStudentDashboard(req: Request, res: Response, next: NextFunction) {
    try {
      const studentId = req.user!.id;
      const data = await studentAttendanceService.getStudentDashboardData(studentId);
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  }

  async submitScan(req: Request, res: Response, next: NextFunction) {
    try {
      const studentId = req.user!.id;
      const { sessionId, scannedCode, scannedAt, deviceSignal, isOfflineSync, latitude, longitude } = req.body;
      const result = await studentAttendanceService.processScan({
        studentId,
        sessionId,
        scannedCode,
        scannedAt: new Date(scannedAt),
        deviceSignal: deviceSignal ?? "wifi - same LAN",
        isOfflineSync: !!isOfflineSync,
        latitude: latitude !== undefined ? Number(latitude) : undefined,
        longitude: longitude !== undefined ? Number(longitude) : undefined,
      });

      try {
        const rollData = await sharedAttendanceService.getLiveRollData(sessionId);
        liveUpdateManager.broadcast(sessionId, { type: "ROLL_UPDATE", ...rollData });
      } catch (err) {
        console.error("Failed to broadcast roll update:", err);
      }

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async syncOffline(req: Request, res: Response, next: NextFunction) {
    try {
      const studentId = req.user!.id;
      const { scans } = req.body;
      const results = await studentAttendanceService.syncOfflineScans(studentId, scans);

      try {
        const uniqueSessionIds = Array.from(
          new Set((scans || []).map((s: any) => s.sessionId))
        );
        for (const sId of uniqueSessionIds) {
          if (sId) {
            const rollData = await sharedAttendanceService.getLiveRollData(sId as string);
            liveUpdateManager.broadcast(sId as string, { type: "ROLL_UPDATE", ...rollData });
          }
        }
      } catch (err) {
        console.error("Failed to broadcast sync roll update:", err);
      }

      res.status(200).json({ results });
    } catch (error) {
      next(error);
    }
  }
}

export const studentAttendanceController = new StudentAttendanceController();
