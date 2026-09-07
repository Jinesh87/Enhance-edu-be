import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authorize,
  authorizeAdminModule,
} from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import { adminAttendanceController } from "./admin-attendance.controller.js";
import { exportStudentAttendanceSchema } from "./admin-attendance-export.validation.js";

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
router.patch(
  "/absences/:id",
  adminAttendanceController.updateAbsenceFollowUp,
);
router.get(
  "/absences/:id/review",
  adminAttendanceController.getAbsenceReviewDraft,
);
router.post(
  "/absences/:id/review-and-send",
  adminAttendanceController.reviewAndSendAbsence,
);
router.get("/records", adminAttendanceController.listRecords);
router.post("/records/:id/correct", adminAttendanceController.correctRecord);
router.get(
  "/records/:id/history",
  adminAttendanceController.getCorrectionHistory,
);
router.post(
  "/export/student/preview",
  validate(exportStudentAttendanceSchema),
  adminAttendanceController.previewStudentAttendance,
);
router.post(
  "/export/student",
  validate(exportStudentAttendanceSchema),
  adminAttendanceController.exportStudentAttendance,
);

export default router;
