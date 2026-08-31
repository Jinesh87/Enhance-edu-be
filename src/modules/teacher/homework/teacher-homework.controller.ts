import type { NextFunction, Request, Response } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import { teacherHomeworkService } from "./teacher-homework.service.js";

class TeacherHomeworkController {
  lookups = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await teacherHomeworkService.lookups(
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
      const page = req.query.page ? Number(req.query.page) : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const search = typeof req.query.search === "string" ? req.query.search : undefined;
      const academicYear = req.query.academicYear ? Number(req.query.academicYear) : undefined;
      const yearGroup = typeof req.query.yearGroup === "string" ? req.query.yearGroup : undefined;
      const termId = typeof req.query.termId === "string" ? req.query.termId : undefined;
      const subjectId = typeof req.query.subjectId === "string" ? req.query.subjectId : undefined;

      const result = await teacherHomeworkService.list(
        req.user!.id,
        req.user!.role as UserRole,
        {
          page,
          limit,
          search,
          academicYear,
          yearGroup,
          termId,
          subjectId,
        },
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const files = Array.isArray(req.files) ? req.files : [];
      const result = await teacherHomeworkService.create(
        req.user!.id,
        req.user!.role as UserRole,
        req.body,
        files.map((file) => ({
          buffer: file.buffer,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
        })),
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const files = Array.isArray(req.files) ? req.files : [];
      const result = await teacherHomeworkService.update(
        req.user!.id,
        req.user!.role as UserRole,
        req.params.homeworkId as string,
        req.body,
        files.map((file) => ({
          buffer: file.buffer,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
        })),
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  delete = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await teacherHomeworkService.delete(
        req.user!.id,
        req.user!.role as UserRole,
        req.params.homeworkId as string,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  getAttachment = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const attachment = await teacherHomeworkService.getAttachment(
        req.user!.id,
        req.user!.role as UserRole,
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

  listSubmissions = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const page = req.query.page ? Number(req.query.page) : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const search =
        typeof req.query.search === "string" ? req.query.search : undefined;
      const status =
        typeof req.query.status === "string" ? req.query.status : undefined;

      const result = await teacherHomeworkService.listSubmissions(
        req.user!.id,
        req.user!.role as UserRole,
        req.params.homeworkId as string,
        {
          page,
          limit,
          search,
          status,
        },
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  getSubmissionFile = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const file = await teacherHomeworkService.getSubmissionFile(
        req.user!.id,
        req.user!.role as UserRole,
        req.params.homeworkId as string,
        req.params.submissionId as string,
        req.params.fileId as string,
      );
      res.setHeader("Content-Type", file.mimeType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(file.originalName)}"`,
      );
      res.status(200).send(file.buffer);
    } catch (error) {
      next(error);
    }
  };

  gradeSubmission = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await teacherHomeworkService.gradeSubmission(
        req.user!.id,
        req.user!.role as UserRole,
        req.params.homeworkId as string,
        req.params.studentId as string,
        req.body,
      );
      res.status(200).json({ submission: result });
    } catch (error) {
      next(error);
    }
  };
}

export const teacherHomeworkController = new TeacherHomeworkController();
