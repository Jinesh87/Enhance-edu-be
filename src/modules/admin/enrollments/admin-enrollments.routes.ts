import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
  authorizeAdminModule,
} from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import { adminEnrollmentsController } from "./admin-enrollments.controller.js";
import {
  enrollmentIdParamsSchema,
  inviteEnrollmentSchema,
  modifyEnrollmentSchema,
} from "./admin-enrollments.validation.js";

const adminEnrollmentsRouter = Router();

adminEnrollmentsRouter.use(
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.OFFICE_STAFF),
  authorizeAdminModule("enrolments"),
);

adminEnrollmentsRouter.get("/", adminEnrollmentsController.list);
adminEnrollmentsRouter.get(
  "/:id",
  validate(enrollmentIdParamsSchema, "params"),
  adminEnrollmentsController.getById,
);
adminEnrollmentsRouter.post(
  "/invite",
  validate(inviteEnrollmentSchema),
  adminEnrollmentsController.invite,
);
adminEnrollmentsRouter.post(
  "/:id/modifications",
  validate(enrollmentIdParamsSchema, "params"),
  validate(modifyEnrollmentSchema),
  adminEnrollmentsController.modify,
);

export default adminEnrollmentsRouter;
