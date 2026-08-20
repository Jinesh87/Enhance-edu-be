import { Router } from "express";
import { UserRole } from "../../common/constants/roles.js";
import {
  authenticate,
  authorize,
  authorizeAdminModule,
} from "../../common/middleware/authenticate.js";
import { validate } from "../../common/middleware/validate.js";
import { usersController } from "./users.controller.js";
import {
  createUserSchema,
  listUsersQuerySchema,
  updateUserSchema,
} from "./users.validation.js";

const usersRouter = Router();

usersRouter.use(
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.OFFICE_STAFF),
);

usersRouter.get(
  "/",
  authorizeAdminModule("people", "classes", "enrolments"),
  validate(listUsersQuerySchema, "query"),
  usersController.list,
);
usersRouter.get("/:id", authorizeAdminModule("people"), usersController.getById);
usersRouter.post(
  "/",
  authorizeAdminModule("people"),
  validate(createUserSchema),
  usersController.invite,
);
usersRouter.patch(
  "/:id",
  authorizeAdminModule("people"),
  validate(updateUserSchema),
  usersController.update,
);
usersRouter.post(
  "/:id/resend-invitation",
  authorizeAdminModule("people"),
  usersController.resendInvitation,
);
usersRouter.post(
  "/:id/deactivate",
  authorizeAdminModule("people"),
  usersController.deactivate,
);
usersRouter.delete(
  "/:id",
  authorizeAdminModule("people"),
  usersController.remove,
);

export default usersRouter;
