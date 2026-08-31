import type { NextFunction, Request, Response } from "express";
import {
  studentClassesService,
  type UploadedHomeworkAnswerFile,
} from "./student-classes.service.js";
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

  listHomework = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await studentClassesService.listHomework(req.user!.id);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  getHomeworkAttachment = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const attachment = await studentClassesService.getHomeworkAttachment(
        req.user!.id,
        req.params.homeworkId as string,
        req.params.attachmentId as string,
      );
      res.setHeader("Content-Type", attachment.mimeType);
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(attachment.originalName)}"`,
      );
      res.status(200).send(attachment.buffer);
    } catch (error) {
      next(error);
    }
  };

  getHomeworkSubmission = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await studentClassesService.getHomeworkSubmission(
        req.user!.id,
        req.params.homeworkId as string,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  uploadHomeworkFiles = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const files = Array.isArray(req.files) ? req.files : [];
      const result = await studentClassesService.uploadHomeworkFiles(
        req.user!.id,
        req.params.homeworkId as string,
        files.map(
          (file): UploadedHomeworkAnswerFile => ({
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

  removeHomeworkFile = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await studentClassesService.removeHomeworkFile(
        req.user!.id,
        req.params.homeworkId as string,
        req.params.fileId as string,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  submitHomework = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const studentNotes =
        typeof req.body?.studentNotes === "string"
          ? req.body.studentNotes
          : undefined;
      const result = await studentClassesService.submitHomework(
        req.user!.id,
        req.params.homeworkId as string,
        { studentNotes },
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  getHomeworkSubmissionFile = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const file = await studentClassesService.getHomeworkSubmissionFile(
        req.user!.id,
        req.params.homeworkId as string,
        req.params.fileId as string,
      );
      res.setHeader("Content-Type", file.mimeType);
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(file.originalName)}"`,
      );
      res.status(200).send(file.buffer);
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
