import { Router } from "express";
import { authenticate } from "../../common/middleware/authenticate.js";
import { attendanceController } from "./attendance.controller.js";

const attendanceRouter = Router();

// Secure all attendance endpoints
attendanceRouter.use(authenticate);

// Student Scanner Endpoints
attendanceRouter.get("/student/dashboard", attendanceController.getStudentDashboard);
attendanceRouter.post("/scan", attendanceController.submitScan);
attendanceRouter.post("/sync-offline", attendanceController.syncOffline);

// Teacher Live Roll Endpoints
attendanceRouter.get("/tutor/dashboard", attendanceController.getTutorDashboard);
attendanceRouter.get("/sessions/:id/qr-code", attendanceController.getQrCode);
attendanceRouter.get("/sessions/:id/roll", attendanceController.getLiveRoll);
attendanceRouter.post("/sessions/:id/mark-manual", attendanceController.markManual);

// Admin Console Endpoints
attendanceRouter.get("/exceptions", attendanceController.listExceptions);
attendanceRouter.post("/exceptions/:id/action", attendanceController.resolveException);

export default attendanceRouter;
