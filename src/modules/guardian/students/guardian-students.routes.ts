import { Router } from "express";
import Joi from "joi";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
} from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import { guardianStudentsController } from "./guardian-students.controller.js";

const guardianStudentsRouter = Router();

const studentIdParamsSchema = Joi.object({
  studentId: Joi.string().uuid().required(),
});

const updateStudentPasswordSchema = Joi.object({
  password: Joi.string().min(8).max(128).required(),
});

guardianStudentsRouter.use(authenticate, authorize(UserRole.GUARDIAN));
guardianStudentsRouter.get("/", guardianStudentsController.list);
guardianStudentsRouter.post(
  "/pending/:id/accept",
  validate(Joi.object({ id: Joi.string().uuid().required() }), "params"),
  guardianStudentsController.acceptPending,
);
guardianStudentsRouter.patch(
  "/:studentId/password",
  validate(studentIdParamsSchema, "params"),
  validate(updateStudentPasswordSchema),
  guardianStudentsController.updatePassword,
);

export default guardianStudentsRouter;
