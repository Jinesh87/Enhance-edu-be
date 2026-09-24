import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
  authorizeAdminModule,
} from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import { adminPayrollController } from "./admin-payroll.controller.js";
import {
  payrollPeriodQuerySchema,
  payrollTeacherParamsSchema,
  upsertPayrollConfigSchema,
} from "./admin-payroll.validation.js";

const adminPayrollRouter = Router();

adminPayrollRouter.use(
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.OFFICE_STAFF),
);

adminPayrollRouter.get("/feature", adminPayrollController.feature);

adminPayrollRouter.use(authorizeAdminModule("payroll"));

adminPayrollRouter.get(
  "/",
  validate(payrollPeriodQuerySchema, "query"),
  adminPayrollController.list,
);

adminPayrollRouter.get(
  "/teachers/:teacherUserId",
  validate(payrollTeacherParamsSchema, "params"),
  validate(payrollPeriodQuerySchema, "query"),
  adminPayrollController.detail,
);

adminPayrollRouter.put(
  "/configs",
  validate(upsertPayrollConfigSchema),
  adminPayrollController.upsertConfig,
);

export default adminPayrollRouter;
