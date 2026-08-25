import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
  authorizeAdminModule,
} from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import { adminAssessmentsController } from "./admin-assessments.controller.js";
import {
  assessmentAttendeeFileParamsSchema,
  assessmentAttendeeParamsSchema,
  assessmentIdParamsSchema,
  createAssessmentSchema,
  listAssessmentsQuerySchema,
  updateAssessmentSchema,
} from "./admin-assessments.validation.js";

const adminAssessmentsRouter = Router();

adminAssessmentsRouter.use(
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.OFFICE_STAFF),
  authorizeAdminModule("classes"),
);

adminAssessmentsRouter.get(
  "/",
  validate(listAssessmentsQuerySchema, "query"),
  adminAssessmentsController.list,
);
adminAssessmentsRouter.get(
  "/:id/attendees",
  validate(assessmentIdParamsSchema, "params"),
  adminAssessmentsController.listAttendees,
);
adminAssessmentsRouter.get(
  "/:id/attendees/:studentId/files/:fileId",
  validate(assessmentAttendeeFileParamsSchema, "params"),
  adminAssessmentsController.getAttendeeFile,
);
adminAssessmentsRouter.get(
  "/:id/attendees/:studentId",
  validate(assessmentAttendeeParamsSchema, "params"),
  adminAssessmentsController.getAttendeeSubmission,
);
adminAssessmentsRouter.get(
  "/:id",
  validate(assessmentIdParamsSchema, "params"),
  adminAssessmentsController.getById,
);
adminAssessmentsRouter.post(
  "/",
  validate(createAssessmentSchema),
  adminAssessmentsController.create,
);
adminAssessmentsRouter.patch(
  "/:id",
  validate(assessmentIdParamsSchema, "params"),
  validate(updateAssessmentSchema),
  adminAssessmentsController.update,
);
adminAssessmentsRouter.delete(
  "/:id/permanent",
  validate(assessmentIdParamsSchema, "params"),
  adminAssessmentsController.remove,
);
adminAssessmentsRouter.delete(
  "/:id",
  validate(assessmentIdParamsSchema, "params"),
  adminAssessmentsController.archive,
);

export default adminAssessmentsRouter;
