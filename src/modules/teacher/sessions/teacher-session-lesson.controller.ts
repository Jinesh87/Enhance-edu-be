import type { NextFunction, Request, Response } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  resolveIncomingFiles,
  respondWithStoredFile,
} from "../../../common/storage/object-storage.js";
import {
  idempotencyLookup,
  idempotencyStore,
  readIdempotencyKey,
} from "../../../common/utils/idempotency.js";
import { sessionLessonService } from "../../shared/sessions/session-lesson.service.js";

class TeacherSessionLessonController {
  getWorkspace = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await sessionLessonService.getTeacherWorkspace(
        String(req.params.sessionId),
        req.user!.id,
        req.user!.role as UserRole,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  upsertLesson = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const idemKey = readIdempotencyKey(req);
      const cached = await idempotencyLookup(idemKey);
      if (cached) {
        return res.status(cached.status).json(cached.body);
      }

      const result = await sessionLessonService.upsertLesson(
        String(req.params.sessionId),
        req.user!.id,
        req.user!.role as UserRole,
        req.body,
      );
      await idempotencyStore(idemKey, 200, result);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  listResources = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await sessionLessonService.listResources(
        String(req.params.sessionId),
        req.user!.id,
        req.user!.role as UserRole,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  uploadResources = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const uploads = resolveIncomingFiles(
        Array.isArray(req.files) ? req.files : undefined,
        req.body,
        req.user!.id,
      );
      const result = await sessionLessonService.uploadResources(
        String(req.params.sessionId),
        req.user!.id,
        req.user!.role as UserRole,
        uploads,
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  getResourceStream = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const file = await sessionLessonService.getResourceForTeacher(
        String(req.params.sessionId),
        String(req.params.resourceId),
        req.user!.id,
        req.user!.role as UserRole,
      );
      await respondWithStoredFile(res, {
        storageKey: file.storageKey,
        mimeType: file.mimeType,
        originalName: file.originalName,
        inline: true,
      });
    } catch (error) {
      next(error);
    }
  };

  updateResource = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await sessionLessonService.updateResource(
        String(req.params.sessionId),
        String(req.params.resourceId),
        req.user!.id,
        req.user!.role as UserRole,
        req.body,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  removeResource = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await sessionLessonService.removeResource(
        String(req.params.sessionId),
        String(req.params.resourceId),
        req.user!.id,
        req.user!.role as UserRole,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const teacherSessionLessonController = new TeacherSessionLessonController();
