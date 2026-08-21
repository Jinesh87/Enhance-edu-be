import type { NextFunction, Request, Response } from "express";
import { writeAuditLog } from "../../common/utils/audit-log.js";
import { classroomsService } from "./classrooms.service.js";

class ClassroomsController {
  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const isActive =
        typeof req.query.isActive === "boolean"
          ? req.query.isActive
          : undefined;
      const classrooms = await classroomsService.list({ isActive });
      res.status(200).json({ classrooms });
    } catch (error) {
      next(error);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const classroom = await classroomsService.create({
        name: req.body.name,
        code: req.body.code,
        capacity: req.body.capacity ?? null,
        isActive: req.body.isActive,
      });
      await writeAuditLog({
        actorUserId: req.user!.id,
        action: "CREATED",
        recordType: "classroom",
        recordId: classroom.id,
        recordLabel: classroom.name,
        after: {
          code: classroom.code,
          capacity: classroom.capacity,
          isActive: classroom.isActive,
        },
      });
      res.status(201).json({ classroom });
    } catch (error) {
      next(error);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const classroom = await classroomsService.update(
        req.params.id as string,
        {
          name: req.body.name,
          code: req.body.code,
          capacity: req.body.capacity ?? null,
          isActive: req.body.isActive,
        },
      );
      await writeAuditLog({
        actorUserId: req.user!.id,
        action: "EDITED",
        recordType: "classroom",
        recordId: classroom.id,
        recordLabel: classroom.name,
        after: {
          code: classroom.code,
          capacity: classroom.capacity,
          isActive: classroom.isActive,
        },
      });
      res.status(200).json({ classroom });
    } catch (error) {
      next(error);
    }
  };
}

export const classroomsController = new ClassroomsController();
