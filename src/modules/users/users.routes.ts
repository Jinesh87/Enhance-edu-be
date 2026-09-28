import { Router } from "express";
import { UserRole } from "../../common/constants/roles.js";
import {
  authenticate,
  authorize,
  authorizeAdminModule,
} from "../../common/middleware/authenticate.js";
import { validate } from "../../common/middleware/validate.js";
import { usersController } from "./users.controller.js";
import { designationsService } from "./designations.service.js";
import {
  createUserSchema,
  designationParamsSchema,
  designationSchema,
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
usersRouter.get(
  "/designations",
  authorizeAdminModule("people"),
  async (_req, res, next) => {
    try {
      res.json({ designations: await designationsService.list() });
    } catch (error) {
      next(error);
    }
  },
);
usersRouter.post(
  "/designations",
  authorizeAdminModule("people"),
  validate(designationSchema),
  async (req, res, next) => {
    try {
      const designation = await designationsService.create(req.body.name, req.user!.id);
      res.status(201).json({ designation });
    } catch (error) {
      next(error);
    }
  },
);
usersRouter.delete(
  "/designations/:designationId",
  authorizeAdminModule("people"),
  validate(designationParamsSchema, "params"),
  async (req, res, next) => {
    try {
      await designationsService.remove(req.params.designationId as string);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
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
