import type { NextFunction, Request, Response } from "express";
import {
  resolveIncomingFiles,
  respondWithStoredFile,
} from "../../../common/storage/object-storage.js";
import { adminSyllabusService } from "./admin-syllabus.service.js";

class AdminSyllabusController {
  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = req.query as {
        page?: number;
        limit?: number;
        search?: string | null;
        subjectId?: string | null;
        academicYearId?: string | null;
        yearLevelId?: string | null;
        termId?: string | null;
        allTerms?: boolean;
      };
      const data = await adminSyllabusService.list({
        page: query.page,
        limit: query.limit,
        search: query.search ?? "",
        subjectId: query.subjectId || undefined,
        academicYearId: query.academicYearId || undefined,
        yearLevelId: query.yearLevelId || undefined,
        termId: query.termId || undefined,
        allTerms: query.allTerms,
      });
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const syllabus = await adminSyllabusService.getById(req.params.id as string);
      res.status(200).json({ syllabus });
    } catch (error) {
      next(error);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const syllabus = await adminSyllabusService.create(req.body, req.user!.id);
      res.status(201).json({ syllabus });
    } catch (error) {
      next(error);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const syllabus = await adminSyllabusService.update(
        req.params.id as string,
        req.body,
        req.user!.id,
      );
      res.status(200).json({ syllabus });
    } catch (error) {
      next(error);
    }
  };

  remove = async (req: Request, res: Response, next: NextFunction) => {
    try {
      await adminSyllabusService.remove(req.params.id as string, req.user!.id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };

  addDocuments = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const files = resolveIncomingFiles(
        req.files as Express.Multer.File[] | undefined,
        req.body,
        req.user!.id,
      );
      const syllabus = await adminSyllabusService.addDocuments(
        req.params.id as string,
        files,
        req.user!.id,
      );
      res.status(200).json({ syllabus });
    } catch (error) {
      next(error);
    }
  };

  removeDocument = async (req: Request, res: Response, next: NextFunction) => {
    try {
      await adminSyllabusService.removeDocument(
        req.params.id as string,
        req.params.documentId as string,
        req.user!.id,
      );
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  };

  downloadDocument = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const file = await adminSyllabusService.getDocumentFile(
        req.params.id as string,
        req.params.documentId as string,
      );
      await respondWithStoredFile(res, {
        storageKey: file.storageKey,
        mimeType: file.mimeType,
        originalName: file.originalName,
        inline: false,
      });
    } catch (error) {
      next(error);
    }
  };
}

export const adminSyllabusController = new AdminSyllabusController();
