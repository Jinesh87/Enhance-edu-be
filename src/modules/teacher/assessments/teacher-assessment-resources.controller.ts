import type { NextFunction, Request, Response } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import { resolveIncomingFiles } from "../../../common/storage/object-storage.js";
import { assessmentResourceService } from "../../shared/assessments/assessment-resource.service.js";

class TeacherAssessmentResourcesController {
  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await assessmentResourceService.listForAssessment(
        req.params.assessmentId as string,
        req.user!.id,
        req.user!.role as UserRole,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  upload = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const uploads = resolveIncomingFiles(
        Array.isArray(req.files) ? req.files : undefined,
        req.body,
        req.user!.id,
      );
      const result = await assessmentResourceService.uploadForAssessment(
        req.params.assessmentId as string,
        req.user!.id,
        req.user!.role as UserRole,
        uploads,
      );
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  remove = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await assessmentResourceService.removeForAssessment(
        req.params.assessmentId as string,
        req.params.resourceId as string,
        req.user!.id,
        req.user!.role as UserRole,
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const teacherAssessmentResourcesController =
  new TeacherAssessmentResourcesController();
