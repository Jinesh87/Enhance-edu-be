import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
} from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import Joi from "joi";
import { guardianStudentsController } from "./guardian-students.controller.js";

const guardianStudentsRouter = Router();

guardianStudentsRouter.use(authenticate, authorize(UserRole.GUARDIAN));
guardianStudentsRouter.get("/", guardianStudentsController.list);
guardianStudentsRouter.post(
  "/pending/:id/accept",
  validate(Joi.object({ id: Joi.string().uuid().required() }), "params"),
  guardianStudentsController.acceptPending,
);

export default guardianStudentsRouter;
