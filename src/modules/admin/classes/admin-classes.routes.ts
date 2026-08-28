import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
  authorizeAdminModule,
} from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import { adminClassesController } from "./admin-classes.controller.js";
import {
  classIdParamsSchema,
  createClassSchema,
  updateClassSchema,
  bulkReplaceClassSchema,
  groupSessionsQuerySchema,
  sessionIdParamsSchema,
  updateSessionSchema,
} from "./admin-classes.validation.js";

const adminClassesRouter = Router();

adminClassesRouter.use(
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.OFFICE_STAFF),
  authorizeAdminModule("classes"),
);

adminClassesRouter.get("/", adminClassesController.list);
adminClassesRouter.get(
  "/calendar-sessions",
  adminClassesController.listCalendarSessions,
);
adminClassesRouter.get(
  "/group-sessions",
  validate(groupSessionsQuerySchema, "query"),
  adminClassesController.listGroupSessions,
);
adminClassesRouter.patch(
  "/sessions/:id",
  validate(sessionIdParamsSchema, "params"),
  validate(updateSessionSchema),
  adminClassesController.updateSession,
);
adminClassesRouter.post(
  "/bulk-replace",
  validate(bulkReplaceClassSchema),
  adminClassesController.bulkReplace,
);
adminClassesRouter.get(
  "/:id/enrolled-students",
  validate(classIdParamsSchema, "params"),
  adminClassesController.listEnrolledStudents,
);
adminClassesRouter.get(
  "/:id",
  validate(classIdParamsSchema, "params"),
  adminClassesController.getById,
);
adminClassesRouter.post(
  "/",
  validate(createClassSchema),
  adminClassesController.create,
);
adminClassesRouter.patch(
  "/:id",
  validate(classIdParamsSchema, "params"),
  validate(updateClassSchema),
  adminClassesController.update,
);
adminClassesRouter.delete(
  "/:id",
  validate(classIdParamsSchema, "params"),
  adminClassesController.remove,
);

export default adminClassesRouter;
