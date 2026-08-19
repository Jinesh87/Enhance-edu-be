import { Router } from "express";
import { teacherAttendanceController } from "./teacher-attendance.controller.js";
import { authorize } from "../../../common/middleware/authenticate.js";
import { UserRole } from "../../../common/constants/roles.js";

const router = Router();
const staffOnly = authorize(UserRole.SUPER_ADMIN, UserRole.STAFF);

router.get("/sessions/:id/qr-code", staffOnly, teacherAttendanceController.getQrCode);
router.get("/sessions/:id/roll", staffOnly, teacherAttendanceController.getLiveRoll);
router.get(
  "/sessions/:id/live-updates",
  staffOnly,
  teacherAttendanceController.streamLiveUpdates,
);
router.post(
  "/sessions/:id/mark-manual",
  staffOnly,
  teacherAttendanceController.markManual,
);

export default router;
