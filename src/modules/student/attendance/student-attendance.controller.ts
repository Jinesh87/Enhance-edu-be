import { NextFunction, Request, Response } from "express";
import { studentAttendanceService } from "./student-attendance.service.js";
import { sharedAttendanceService } from "../../shared/attendance/shared-attendance.service.js";
import { liveUpdateManager } from "../../shared/attendance/live-updates.js";

class StudentAttendanceController {
  async getStudentDashboard(req: Request, res: Response, next: NextFunction) {
    try {
      const studentId = req.user!.id;

      const data =
        await studentAttendanceService.getStudentDashboardData(studentId);

      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  }

  async submitScan(req: Request, res: Response, next: NextFunction) {
    try {
      const studentId = req.user!.id;

      const { sessionId, scannedCode, deviceSignal, latitude, longitude } =
        req.body;

      const result = await studentAttendanceService.processScan({
        studentId,
        sessionId,
        scannedCode,

        // Online scans always use trusted server time.
        scannedAt: new Date(),

        deviceSignal: deviceSignal ?? "wifi",
        isOfflineSync: false,

        latitude: latitude !== undefined ? Number(latitude) : undefined,

        longitude: longitude !== undefined ? Number(longitude) : undefined,
      });

      try {
        const rollData =
          await sharedAttendanceService.getLiveRollData(sessionId);

        liveUpdateManager.broadcast(sessionId, {
          type: "ROLL_UPDATE",
          ...rollData,
        });
      } catch (error) {
        console.error("Failed to broadcast roll update:", error);
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

      if (!Array.isArray(scans)) {
        return res.status(400).json({
          message: "Scans must be an array",
        });
      }

      const results = await studentAttendanceService.syncOfflineScans(
        studentId,
        scans,
      );

      try {
        const sessionIds = new Set<string>();

        for (const scan of scans) {
          if (scan.sessionId) {
            sessionIds.add(scan.sessionId);
          }
        }

        for (const sessionId of sessionIds) {
          const rollData =
            await sharedAttendanceService.getLiveRollData(sessionId);

          liveUpdateManager.broadcast(sessionId, {
            type: "ROLL_UPDATE",
            ...rollData,
          });
        }
      } catch (error) {
        console.error("Failed to broadcast sync roll update:", error);
      }

      res.status(200).json({
        results,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const studentAttendanceController = new StudentAttendanceController();
