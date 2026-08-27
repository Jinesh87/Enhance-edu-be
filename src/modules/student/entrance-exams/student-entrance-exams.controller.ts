import type { NextFunction, Request, Response } from "express";
import { studentEntranceExamsService } from "./student-entrance-exams.service.js";

class StudentEntranceExamsController {
  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await studentEntranceExamsService.listAvailable(req.user!.id);
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  getSubmission = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await studentEntranceExamsService.getSubmission(
        req.user!.id,
        String(req.params.assessmentId),
      );
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  upload = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      const data = await studentEntranceExamsService.uploadFiles(
        req.user!.id,
        String(req.params.assessmentId),
        files.map((file) => ({
          buffer: file.buffer,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
        })),
      );
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  removeFile = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await studentEntranceExamsService.removeFile(
        req.user!.id,
        String(req.params.assessmentId),
        String(req.params.fileId),
      );
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };

  submit = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await studentEntranceExamsService.submit(
        req.user!.id,
        String(req.params.assessmentId),
      );
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  };
}

export const studentEntranceExamsController =
  new StudentEntranceExamsController();
