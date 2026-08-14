import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
} from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import { adminClassesController } from "./admin-classes.controller.js";
import {
  classIdParamsSchema,
  createClassSchema,
  updateClassSchema,
} from "./admin-classes.validation.js";

const adminClassesRouter = Router();

adminClassesRouter.use(authenticate, authorize(UserRole.SUPER_ADMIN));

adminClassesRouter.get("/", adminClassesController.list);
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
