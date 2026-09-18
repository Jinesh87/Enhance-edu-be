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
  "/attendance/student/:studentId",
  validate(reportQuerySchema, "query"),
  adminReportsController.studentAttendanceDetails,
);

adminReportsRouter.get(
  "/enquiries-funnel",
  validate(reportQuerySchema, "query"),
  adminReportsController.enquiriesFunnel,
);

adminReportsRouter.get(
  "/enquiries-funnel/:id/journey",
  adminReportsController.enquiryJourney,
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
  "/assessments/:id/submissions",
  adminReportsController.assessmentSubmissions,
);

adminReportsRouter.get(
  "/homework",
  validate(reportQuerySchema, "query"),
  adminReportsController.homework,
);

adminReportsRouter.get(
  "/homework/:id/submissions",
  adminReportsController.homeworkSubmissions,
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
