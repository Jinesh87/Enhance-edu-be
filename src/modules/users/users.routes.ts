import { Router } from "express";
import { UserRole } from "../../common/constants/roles.js";
import {
  authenticate,
  authorize,
} from "../../common/middleware/authenticate.js";
import { validate } from "../../common/middleware/validate.js";
import { usersController } from "./users.controller.js";
import {
  createUserSchema,
  listUsersQuerySchema,
  updateUserSchema,
} from "./users.validation.js";

const usersRouter = Router();

usersRouter.use(authenticate, authorize(UserRole.SUPER_ADMIN));

usersRouter.get("/", validate(listUsersQuerySchema, "query"), usersController.list);
usersRouter.get("/:id", usersController.getById);
usersRouter.post("/", validate(createUserSchema), usersController.invite);
usersRouter.patch("/:id", validate(updateUserSchema), usersController.update);
usersRouter.post("/:id/resend-invitation", usersController.resendInvitation);
usersRouter.post("/:id/deactivate", usersController.deactivate);

export default usersRouter;
