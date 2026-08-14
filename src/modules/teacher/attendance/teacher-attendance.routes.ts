import { Router } from "express";
import { teacherAttendanceController } from "./teacher-attendance.controller.js";
import { authorize } from "../../../common/middleware/authenticate.js";
import { UserRole } from "../../../common/constants/roles.js";

const router = Router();

router.use(authorize(UserRole.SUPER_ADMIN, UserRole.STAFF));

router.get("/tutor/dashboard", teacherAttendanceController.getTeacherDashboard);
router.get("/sessions/:id/qr-code", teacherAttendanceController.getQrCode);
router.get("/sessions/:id/roll", teacherAttendanceController.getLiveRoll);
router.get("/sessions/:id/live-updates", teacherAttendanceController.streamLiveUpdates);
router.post("/sessions/:id/mark-manual", teacherAttendanceController.markManual);

export default router;
