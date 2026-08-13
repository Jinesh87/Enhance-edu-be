import { Router } from "express";
import { studentAttendanceController } from "./student-attendance.controller.js";

const router = Router();

router.get("/student/dashboard", studentAttendanceController.getStudentDashboard);
router.post("/scan", studentAttendanceController.submitScan);
router.post("/sync-offline", studentAttendanceController.syncOffline);

export default router;
