import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
} from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import { adminEnrollmentsController } from "./admin-enrollments.controller.js";
import { inviteEnrollmentSchema } from "./admin-enrollments.validation.js";

const adminEnrollmentsRouter = Router();

adminEnrollmentsRouter.use(authenticate, authorize(UserRole.SUPER_ADMIN));

adminEnrollmentsRouter.get("/", adminEnrollmentsController.list);
adminEnrollmentsRouter.post(
  "/invite",
  validate(inviteEnrollmentSchema),
  adminEnrollmentsController.invite,
);

export default adminEnrollmentsRouter;
