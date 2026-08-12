import { NextFunction, Request, Response } from "express";
import { attendanceService } from "./attendance.service.js";

class AttendanceController {
  async getStudentDashboard(req: Request, res: Response, next: NextFunction) {
    try {
      const studentId = req.user!.id;
      const data = await attendanceService.getStudentDashboardData(studentId);
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  }

  async submitScan(req: Request, res: Response, next: NextFunction) {
    try {
      const studentId = req.user!.id;
      const { sessionId, scannedCode, scannedAt, deviceSignal, isOfflineSync } = req.body;
      const result = await attendanceService.processScan({
        studentId,
        sessionId,
        scannedCode,
        scannedAt: new Date(scannedAt),
        deviceSignal: deviceSignal ?? "wifi - same LAN",
        isOfflineSync: !!isOfflineSync,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async syncOffline(req: Request, res: Response, next: NextFunction) {
    try {
      const studentId = req.user!.id;
      const { scans } = req.body; // Array of scan events
      const results = await attendanceService.syncOfflineScans(studentId, scans);
      res.status(200).json({ results });
    } catch (error) {
      next(error);
    }
  }

  async getTutorDashboard(req: Request, res: Response, next: NextFunction) {
    try {
      const teacherId = req.user!.id;
      const data = await attendanceService.getTutorDashboardData(teacherId);
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  }

  async getQrCode(req: Request, res: Response, next: NextFunction) {
    try {
      const sessionId = req.params.id as string;
      const result = await attendanceService.generateSessionQrCode(sessionId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async getLiveRoll(req: Request, res: Response, next: NextFunction) {
    try {
      const sessionId = req.params.id as string;
      const result = await attendanceService.getLiveRollData(sessionId);
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
      const record = await attendanceService.markManualRoll({
        sessionId,
        studentId,
        status,
        reason,
        markedByUserId,
      });
      res.status(200).json({ record });
    } catch (error) {
      next(error);
    }
  }

  async listExceptions(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await attendanceService.getExceptionsAndAbsences();
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
      const result = await attendanceService.resolveScanException(
        scanEventId,
        decision,
        resolvedByUserId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}

export const attendanceController = new AttendanceController();
