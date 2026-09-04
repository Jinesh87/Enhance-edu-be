import type { NextFunction, Request, Response } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import { resolveIncomingFiles } from "../../../common/storage/object-storage.js";
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
      const result = await sessionLessonService.upsertLesson(
        String(req.params.sessionId),
        req.user!.id,
        req.user!.role as UserRole,
        req.body,
      );
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
      let meta: Array<{ title?: string; description?: string }> = [];
      if (typeof req.body.meta === "string" && req.body.meta.trim()) {
        try {
          const parsed = JSON.parse(req.body.meta) as unknown;
          if (Array.isArray(parsed)) {
            meta = parsed as Array<{ title?: string; description?: string }>;
          }
        } catch {
          meta = [];
        }
      } else if (Array.isArray(req.body.meta)) {
        meta = req.body.meta as Array<{ title?: string; description?: string }>;
      }

      const result = await sessionLessonService.uploadResources(
        String(req.params.sessionId),
        req.user!.id,
        req.user!.role as UserRole,
        uploads.map((file, index) => ({
          ...file,
          title: meta[index]?.title,
          description: meta[index]?.description,
        })),
      );
      res.status(201).json(result);
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

export const teacherSessionLessonController =
  new TeacherSessionLessonController();
