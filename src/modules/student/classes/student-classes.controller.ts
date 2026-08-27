import type { NextFunction, Request, Response } from "express";
import { studentClassesService } from "./student-classes.service.js";
import {
  studentEntranceExamsService,
  type UploadedExamFile,
} from "../entrance-exams/student-entrance-exams.service.js";
import { assessmentResourceService } from "../../shared/assessments/assessment-resource.service.js";

class StudentClassesController {
  getTimetable = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await studentClassesService.getTimetable(req.user!.id);
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  getLesson = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const lesson = await studentClassesService.getLesson(
        req.user!.id,
        req.params.sessionId as string,
      );
      res.status(200).json({ lesson });
    } catch (error) {
      next(error);
    }
  };

  getAssessmentSubmission = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await studentEntranceExamsService.getAssessmentSubmission(
        req.user!.id,
        req.params.assessmentId as string,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  uploadAssessmentFiles = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const files = Array.isArray(req.files) ? req.files : [];
      const result = await studentEntranceExamsService.uploadAssessmentFiles(
        req.user!.id,
        req.params.assessmentId as string,
        files.map(
          (file): UploadedExamFile => ({
            buffer: file.buffer,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
          }),
        ),
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  removeAssessmentFile = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await studentEntranceExamsService.removeAssessmentFile(
        req.user!.id,
        req.params.assessmentId as string,
        req.params.fileId as string,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  submitAssessment = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await studentEntranceExamsService.submitAssessment(
        req.user!.id,
        req.params.assessmentId as string,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  getAssessmentResource = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const resource = await assessmentResourceService.getForStudent(
        req.user!.id,
        req.params.assessmentId as string,
        req.params.resourceId as string,
      );
      res.setHeader("Content-Type", resource.mimeType);
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(resource.originalName)}"`,
      );
      res.status(200).send(resource.buffer);
    } catch (error) {
      next(error);
    }
  };
}

export const studentClassesController = new StudentClassesController();
