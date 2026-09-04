import type { NextFunction, Request, Response } from "express";
import {
  resolveIncomingFiles,
  respondWithStoredFile,
} from "../../../common/storage/object-storage.js";
import {
  studentClassesService,
  type UploadedHomeworkAnswerFile,
} from "./student-classes.service.js";
import {
  studentEntranceExamsService,
  type UploadedExamFile,
} from "../entrance-exams/student-entrance-exams.service.js";
import { assessmentResourceService } from "../../shared/assessments/assessment-resource.service.js";
import { sessionLessonService } from "../../shared/sessions/session-lesson.service.js";

class StudentClassesController {
  getSessionSubjects = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const data = await studentClassesService.getStudentSubjects(req.user!.id);
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  listUpcomingSessions = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const data = await studentClassesService.listUpcomingSessions(
        req.user!.id,
        {
          subject: req.query.subject as string | undefined,
          range: (req.query.range as "initial" | "week") ?? "initial",
          weekStart: req.query.weekStart as string | undefined,
        },
      );
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  listPastSessions = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await studentClassesService.listPastSessions(req.user!.id, {
        subject: req.query.subject as string | undefined,
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

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
      await respondWithStoredFile(res, {
        storageKey: attachment.storageKey,
        mimeType: attachment.mimeType,
        originalName: attachment.originalName,
      });
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
      const uploads = resolveIncomingFiles(
        Array.isArray(req.files) ? req.files : undefined,
        req.body,
        req.user!.id,
      ) as UploadedHomeworkAnswerFile[];
      const result = await studentClassesService.uploadHomeworkFiles(
        req.user!.id,
        req.params.homeworkId as string,
        uploads,
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
      await respondWithStoredFile(res, {
        storageKey: file.storageKey,
        mimeType: file.mimeType,
        originalName: file.originalName,
      });
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
      const uploads = resolveIncomingFiles(
        Array.isArray(req.files) ? req.files : undefined,
        req.body,
        req.user!.id,
      ) as UploadedExamFile[];
      const result = await studentEntranceExamsService.uploadAssessmentFiles(
        req.user!.id,
        req.params.assessmentId as string,
        uploads,
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
        req.params.assessmentId as string,
        req.params.resourceId as string,
        req.user!.id,
      );
      await respondWithStoredFile(res, {
        storageKey: resource.storageKey,
        mimeType: resource.mimeType,
        originalName: resource.originalName,
      });
    } catch (error) {
      next(error);
    }
  };

  getSessionResource = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const resource = await sessionLessonService.getResourceForStudent(
        String(req.params.sessionId),
        String(req.params.resourceId),
        req.user!.id,
      );
      await respondWithStoredFile(res, {
        storageKey: resource.storageKey,
        mimeType: resource.mimeType,
        originalName: resource.originalName,
      });
    } catch (error) {
      next(error);
    }
  };
}

export const studentClassesController = new StudentClassesController();
