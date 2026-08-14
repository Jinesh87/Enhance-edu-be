import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
} from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import { adminTermsController } from "./admin-terms.controller.js";
import {
  createTermSchema,
  termIdParamsSchema,
  updateTermSchema,
} from "./admin-terms.validation.js";

const adminTermsRouter = Router();

adminTermsRouter.use(authenticate, authorize(UserRole.SUPER_ADMIN));

adminTermsRouter.get("/", adminTermsController.list);
adminTermsRouter.post("/", validate(createTermSchema), adminTermsController.create);
adminTermsRouter.patch(
  "/:id",
  validate(termIdParamsSchema, "params"),
  validate(updateTermSchema),
  adminTermsController.update,
);
adminTermsRouter.delete(
  "/:id",
  validate(termIdParamsSchema, "params"),
  adminTermsController.remove,
);

export default adminTermsRouter;
