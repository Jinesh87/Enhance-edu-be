import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
} from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import { myTasksController } from "./my-tasks.controller.js";
import {
  completeMyTaskSchema,
  listMyTasksQuerySchema,
  myTaskIdParamsSchema,
} from "./my-tasks.validation.js";

const myTasksRouter = Router();

myTasksRouter.use(
  authenticate,
  authorize(UserRole.STAFF, UserRole.OFFICE_STAFF, UserRole.SUPER_ADMIN),
);

myTasksRouter.get(
  "/",
  validate(listMyTasksQuerySchema, "query"),
  myTasksController.list,
);
myTasksRouter.get(
  "/:id",
  validate(myTaskIdParamsSchema, "params"),
  myTasksController.getById,
);
myTasksRouter.post(
  "/:id/complete",
  validate(myTaskIdParamsSchema, "params"),
  validate(completeMyTaskSchema),
  myTasksController.complete,
);

export default myTasksRouter;
