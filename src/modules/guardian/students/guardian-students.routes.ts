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

const acceptPendingParamsSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

const acceptPendingBodySchema = Joi.object({
  username: Joi.string()
    .trim()
    .min(3)
    .max(50)
    .pattern(/^[a-zA-Z0-9._-]+$/)
    .optional(),
  password: Joi.string().min(8).max(128).optional(),
}).and("username", "password");

guardianStudentsRouter.use(authenticate, authorize(UserRole.GUARDIAN));
guardianStudentsRouter.get("/", guardianStudentsController.list);
guardianStudentsRouter.post(
  "/pending/:id/accept",
  validate(acceptPendingParamsSchema, "params"),
  validate(acceptPendingBodySchema),
  guardianStudentsController.acceptPending,
);
guardianStudentsRouter.patch(
  "/:studentId/password",
  validate(studentIdParamsSchema, "params"),
  validate(updateStudentPasswordSchema),
  guardianStudentsController.updatePassword,
);

export default guardianStudentsRouter;
