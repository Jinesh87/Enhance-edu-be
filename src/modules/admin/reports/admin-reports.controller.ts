import type { NextFunction, Request, Response } from "express";
import { adminReportsService } from "./admin-reports.service.js";
import type { ReportQueryInput, ReportExportInput, NotifyGuardianInput } from "./admin-reports.validation.js";

export class AdminReportsController {
  async attendance(req: Request, res: Response, next: NextFunction) {
    try {
      const filters = req.query as unknown as ReportQueryInput;
      const report = await adminReportsService.getAttendanceReport(filters);
      res.json(report);
    } catch (error) {
      next(error);
    }
  }

  async enquiriesFunnel(req: Request, res: Response, next: NextFunction) {
    try {
      const filters = req.query as unknown as ReportQueryInput;
      const report = await adminReportsService.getEnquiryFunnelReport(filters);
      res.json(report);
    } catch (error) {
      next(error);
    }
  }

  async classesSessions(req: Request, res: Response, next: NextFunction) {
    try {
      const filters = req.query as unknown as ReportQueryInput;
      const report = await adminReportsService.getClassesSessionsReport(filters);
      res.json(report);
    } catch (error) {
      next(error);
    }
  }

  async assessments(req: Request, res: Response, next: NextFunction) {
    try {
      const filters = req.query as unknown as ReportQueryInput;
      const report = await adminReportsService.getAssessmentsReport(filters);
      res.json(report);
    } catch (error) {
      next(error);
    }
  }

  async homework(req: Request, res: Response, next: NextFunction) {
    try {
      const filters = req.query as unknown as ReportQueryInput;
      const report = await adminReportsService.getHomeworkReport(filters);
      res.json(report);
    } catch (error) {
      next(error);
    }
  }

  async exportReport(req: Request, res: Response, next: NextFunction) {
    try {
      const { tab, filters } = req.body as ReportExportInput;
      const currentUser = (req as Request & { user?: { id: string; fullName: string } }).user || {
        id: "system",
        fullName: "Admin User",
      };

      const result = await adminReportsService.exportReportCsv(tab, filters, currentUser);

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
      res.status(200).send(`\uFEFF${result.csvContent}`);
    } catch (error) {
      next(error);
    }
  }

  async notifyGuardian(req: Request, res: Response, next: NextFunction) {
    try {
      const input = req.body as NotifyGuardianInput;
      const currentUser = (req as Request & { user?: { id: string; fullName: string } }).user || {
        id: "system",
        fullName: "Admin User",
      };

      const result = await adminReportsService.notifyGuardianAttendance(input, currentUser);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async assessmentSubmissions(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const result = await adminReportsService.getAssessmentSubmissions(id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async homeworkSubmissions(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const result = await adminReportsService.getHomeworkSubmissions(id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async studentAttendanceDetails(req: Request, res: Response, next: NextFunction) {
    try {
      const studentId = String(req.params.studentId);
      const filters = req.query as unknown as ReportQueryInput;
      const result = await adminReportsService.getStudentAttendanceDetails(studentId, filters);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async enquiryJourney(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const result = await adminReportsService.getEnquiryJourney(id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}

export const adminReportsController = new AdminReportsController();
