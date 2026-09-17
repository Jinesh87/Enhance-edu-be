import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
  authorizeAdminModule,
} from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import { adminReportsController } from "./admin-reports.controller.js";
import {
  reportQuerySchema,
  reportExportSchema,
  notifyGuardianSchema,
} from "./admin-reports.validation.js";

const adminReportsRouter = Router();

adminReportsRouter.use(
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.OFFICE_STAFF),
  authorizeAdminModule("reports"),
);

adminReportsRouter.get(
  "/attendance",
  validate(reportQuerySchema, "query"),
  adminReportsController.attendance,
);

adminReportsRouter.get(
  "/enquiries-funnel",
  validate(reportQuerySchema, "query"),
  adminReportsController.enquiriesFunnel,
);

adminReportsRouter.get(
  "/classes-sessions",
  validate(reportQuerySchema, "query"),
  adminReportsController.classesSessions,
);

adminReportsRouter.get(
  "/assessments",
  validate(reportQuerySchema, "query"),
  adminReportsController.assessments,
);

adminReportsRouter.get(
  "/homework",
  validate(reportQuerySchema, "query"),
  adminReportsController.homework,
);

adminReportsRouter.post(
  "/export",
  validate(reportExportSchema),
  adminReportsController.exportReport,
);

adminReportsRouter.post(
  "/notify-guardian",
  validate(notifyGuardianSchema),
  adminReportsController.notifyGuardian,
);

export default adminReportsRouter;
