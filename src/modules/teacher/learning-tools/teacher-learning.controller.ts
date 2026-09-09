import type { NextFunction, Request, Response } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import { resolveIncomingFiles } from "../../../common/storage/object-storage.js";
import { teacherLearningService } from "./teacher-learning.service.js";

function parseBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value === "true" || value === "1";
  }
  return false;
}

class TeacherLearningController {
  lookups = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await teacherLearningService.lookups(
        req.user!.id,
        req.user!.role as UserRole,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await teacherLearningService.list(
        req.user!.id,
        req.user!.role as UserRole,
        {
          subjectId:
            typeof req.query.subjectId === "string"
              ? req.query.subjectId
              : undefined,
          termId:
            typeof req.query.termId === "string" ? req.query.termId : undefined,
          status:
            typeof req.query.status === "string" ? req.query.status : undefined,
        },
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  get = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await teacherLearningService.getById(
        req.user!.id,
        req.user!.role as UserRole,
        req.params.setId as string,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const uploads = resolveIncomingFiles(
        Array.isArray(req.files) ? req.files : undefined,
        req.body,
        req.user!.id,
      );
      const result = await teacherLearningService.create(
        req.user!.id,
        req.user!.role as UserRole,
        {
          title: req.body.title,
          subjectId: req.body.subjectId,
          termId: req.body.termId,
          yearGroup: req.body.yearGroup,
          generationType: req.body.generationType,
          difficulty: req.body.difficulty,
          itemCount: req.body.itemCount
            ? Number(req.body.itemCount)
            : undefined,
          marksPerQuestion: req.body.marksPerQuestion
            ? Number(req.body.marksPerQuestion)
            : undefined,
          forceOcr: parseBool(req.body.forceOcr),
        },
        uploads[0] ?? null,
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await teacherLearningService.update(
        req.user!.id,
        req.user!.role as UserRole,
        req.params.setId as string,
        req.body,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  remove = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await teacherLearningService.remove(
        req.user!.id,
        req.user!.role as UserRole,
        req.params.setId as string,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  generate = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await teacherLearningService.generate(
        req.user!.id,
        req.user!.role as UserRole,
        req.params.setId as string,
        { forceOcr: parseBool(req.body?.forceOcr) },
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  publish = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await teacherLearningService.publish(
        req.user!.id,
        req.user!.role as UserRole,
        req.params.setId as string,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  unpublish = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await teacherLearningService.unpublish(
        req.user!.id,
        req.user!.role as UserRole,
        req.params.setId as string,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  addFlashcard = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await teacherLearningService.addFlashcard(
        req.user!.id,
        req.user!.role as UserRole,
        req.params.setId as string,
        req.body,
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  updateFlashcard = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await teacherLearningService.updateFlashcard(
        req.user!.id,
        req.user!.role as UserRole,
        req.params.flashcardId as string,
        req.body,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  deleteFlashcard = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await teacherLearningService.deleteFlashcard(
        req.user!.id,
        req.user!.role as UserRole,
        req.params.flashcardId as string,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  addQuizQuestion = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await teacherLearningService.addQuizQuestion(
        req.user!.id,
        req.user!.role as UserRole,
        req.params.setId as string,
        req.body,
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  updateQuizQuestion = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await teacherLearningService.updateQuizQuestion(
        req.user!.id,
        req.user!.role as UserRole,
        req.params.questionId as string,
        req.body,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  deleteQuizQuestion = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await teacherLearningService.deleteQuizQuestion(
        req.user!.id,
        req.user!.role as UserRole,
        req.params.questionId as string,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  addRevision = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await teacherLearningService.addRevision(
        req.user!.id,
        req.user!.role as UserRole,
        req.params.setId as string,
        req.body,
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  updateRevision = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await teacherLearningService.updateRevision(
        req.user!.id,
        req.user!.role as UserRole,
        req.params.revisionId as string,
        req.body,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  deleteRevision = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await teacherLearningService.deleteRevision(
        req.user!.id,
        req.user!.role as UserRole,
        req.params.revisionId as string,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  leaderboard = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await teacherLearningService.leaderboard(
        req.user!.id,
        req.user!.role as UserRole,
        req.params.setId as string,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  listAttempts = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await teacherLearningService.listAttempts(
        req.user!.id,
        req.user!.role as UserRole,
        req.params.setId as string,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  getAttemptReview = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await teacherLearningService.getAttemptReview(
        req.user!.id,
        req.user!.role as UserRole,
        req.params.attemptId as string,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  getStudentActivity = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await teacherLearningService.getStudentActivity(
        req.user!.id,
        req.user!.role as UserRole,
        req.params.setId as string,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const teacherLearningController = new TeacherLearningController();
