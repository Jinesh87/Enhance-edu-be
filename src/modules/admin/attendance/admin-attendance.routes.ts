import { Router } from "express";
import { adminAttendanceController } from "./admin-attendance.controller.js";

const router = Router();

router.get("/exceptions", adminAttendanceController.listExceptions);
router.post("/exceptions/:id/action", adminAttendanceController.resolveException);

export default router;
