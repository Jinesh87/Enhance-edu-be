import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
} from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import { adminTasksController } from "./admin-tasks.controller.js";
import { taskIdParamsSchema } from "./admin-tasks.validation.js";

const adminTasksRouter = Router();

adminTasksRouter.use(authenticate, authorize(UserRole.SUPER_ADMIN));

adminTasksRouter.get("/", adminTasksController.list);
adminTasksRouter.get("/live-updates", adminTasksController.streamLiveUpdates);
adminTasksRouter.post(
  "/:id/complete",
  validate(taskIdParamsSchema, "params"),
  adminTasksController.complete,
);

export default adminTasksRouter;
