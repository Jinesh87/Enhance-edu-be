import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
  authorizeAdminModule,
} from "../../../common/middleware/authenticate.js";
import { adminDashboardController } from "./admin-dashboard.controller.js";

const adminDashboardRouter = Router();

adminDashboardRouter.use(
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.OFFICE_STAFF),
  authorizeAdminModule("dashboard"),
);

adminDashboardRouter.get("/", adminDashboardController.snapshot);

export default adminDashboardRouter;
