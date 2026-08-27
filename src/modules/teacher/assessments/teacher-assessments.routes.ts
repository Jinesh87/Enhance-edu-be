import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
} from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import { writeAuditLog } from "../../../common/utils/audit-log.js";
import { adminAssessmentsController } from "../../admin/assessments/admin-assessments.controller.js";
import { adminAssessmentsService } from "../../admin/assessments/admin-assessments.service.js";
import {
  assessmentAttendeeFileParamsSchema,
  assessmentAttendeeParamsSchema,
  assessmentIdParamsSchema,
  markAttendeeSchema,
} from "../../admin/assessments/admin-assessments.validation.js";

const teacherAssessmentsRouter = Router();

teacherAssessmentsRouter.use(authenticate, authorize(UserRole.STAFF));

teacherAssessmentsRouter.get("/", async (req, res, next) => {
  try {
    const data = await adminAssessmentsService.listMarkingQueue(req.user!.id);
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
});

async function requireAssignedTeacher(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    await adminAssessmentsService.assertCanAccessAttendees(
      req.params.id as string,
      { id: req.user!.id, role: req.user!.role },
    );
    next();
  } catch (error) {
    next(error);
  }
}

teacherAssessmentsRouter.get(
  "/:id/attendees",
  validate(assessmentIdParamsSchema, "params"),
  requireAssignedTeacher,
  adminAssessmentsController.listAttendees,
);

teacherAssessmentsRouter.get(
  "/:id/attendees/:studentId/files/:fileId",
  validate(assessmentAttendeeFileParamsSchema, "params"),
  requireAssignedTeacher,
  adminAssessmentsController.getAttendeeFile,
);

teacherAssessmentsRouter.get(
  "/:id/attendees/:studentId",
  validate(assessmentAttendeeParamsSchema, "params"),
  requireAssignedTeacher,
  adminAssessmentsController.getAttendeeSubmission,
);

teacherAssessmentsRouter.post(
  "/:id/attendees/:studentId/mark",
  validate(assessmentAttendeeParamsSchema, "params"),
  validate(markAttendeeSchema),
  requireAssignedTeacher,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await adminAssessmentsService.markAttendeeSubmission(
        req.params.id as string,
        req.params.studentId as string,
        req.body,
        {
          id: req.user!.id,
          role: req.user!.role,
        },
      );
      await writeAuditLog({
        actorUserId: req.user!.id,
        action: "EDITED",
        recordType: "assessment_submission",
        recordId: data.submission.id,
        recordLabel: `${data.assessment.name} · ${data.student.fullName}`,
        after: {
          mark: data.submission.mark,
          outcome: data.submission.outcome,
        },
      });
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  },
);

export default teacherAssessmentsRouter;
