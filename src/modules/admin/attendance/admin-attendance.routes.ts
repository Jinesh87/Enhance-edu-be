import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authorize,
  authorizeAdminModule,
} from "../../../common/middleware/authenticate.js";
import { adminAttendanceController } from "./admin-attendance.controller.js";

const router = Router();

router.use(
  authorize(UserRole.SUPER_ADMIN, UserRole.OFFICE_STAFF),
  authorizeAdminModule("attendance"),
);

router.get("/exceptions", adminAttendanceController.listExceptions);
router.post(
  "/exceptions/:id/action",
  adminAttendanceController.resolveException,
);

export default router;
