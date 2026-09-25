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
  staffEntryParamsSchema,
  staffParamsSchema,
  staffWorkEntrySchema,
  upsertPayrollConfigSchema,
  upsertStaffConfigSchema,
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

adminPayrollRouter.get(
  "/staff",
  validate(payrollPeriodQuerySchema, "query"),
  adminPayrollController.staffList,
);

adminPayrollRouter.put(
  "/staff/configs",
  validate(upsertStaffConfigSchema),
  adminPayrollController.upsertStaffConfig,
);

adminPayrollRouter.put(
  "/staff/entries/:entryId",
  validate(staffEntryParamsSchema, "params"),
  validate(staffWorkEntrySchema),
  adminPayrollController.updateStaffEntry,
);

adminPayrollRouter.delete(
  "/staff/entries/:entryId",
  validate(staffEntryParamsSchema, "params"),
  adminPayrollController.deleteStaffEntry,
);

adminPayrollRouter.get(
  "/staff/:staffUserId",
  validate(staffParamsSchema, "params"),
  validate(payrollPeriodQuerySchema, "query"),
  adminPayrollController.staffDetail,
);

adminPayrollRouter.post(
  "/staff/:staffUserId/entries",
  validate(staffParamsSchema, "params"),
  validate(staffWorkEntrySchema),
  adminPayrollController.createStaffEntry,
);

export default adminPayrollRouter;
