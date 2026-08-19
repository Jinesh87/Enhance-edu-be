import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
  authorizeAdminModule,
} from "../../../common/middleware/authenticate.js";
import { adminYearLevelsController } from "./admin-year-levels.controller.js";

const adminYearLevelsRouter = Router();

adminYearLevelsRouter.use(
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.OFFICE_STAFF),
  authorizeAdminModule("subjects", "terms", "classes", "enrolments"),
);

adminYearLevelsRouter.get("/", adminYearLevelsController.list);

export default adminYearLevelsRouter;
