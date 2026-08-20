import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
  authorizeAdminModule,
} from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import { adminSubjectsController } from "./admin-subjects.controller.js";
import {
  createSubjectSchema,
  subjectIdParamsSchema,
  updateSubjectSchema,
} from "./admin-subjects.validation.js";

const adminSubjectsRouter = Router();

adminSubjectsRouter.use(
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.OFFICE_STAFF),
);

adminSubjectsRouter.get(
  "/",
  authorizeAdminModule("subjects", "classes", "enrolments", "people", "enquiries"),
  adminSubjectsController.list,
);
adminSubjectsRouter.use(authorizeAdminModule("subjects"));
adminSubjectsRouter.post("/", validate(createSubjectSchema), adminSubjectsController.create);
adminSubjectsRouter.patch(
  "/:id",
  validate(subjectIdParamsSchema, "params"),
  validate(updateSubjectSchema),
  adminSubjectsController.update,
);
adminSubjectsRouter.delete(
  "/:id",
  validate(subjectIdParamsSchema, "params"),
  adminSubjectsController.remove,
);

export default adminSubjectsRouter;
