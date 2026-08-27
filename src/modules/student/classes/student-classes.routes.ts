import { Router } from "express";
import multer from "multer";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
} from "../../../common/middleware/authenticate.js";
import { studentClassesController } from "./student-classes.controller.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 20 },
});

router.use(authenticate, authorize(UserRole.STUDENT));

router.get("/timetable", studentClassesController.getTimetable);
router.get("/lessons/:sessionId", studentClassesController.getLesson);
router.get(
  "/assessments/:assessmentId/submission",
  studentClassesController.getAssessmentSubmission,
);
router.post(
  "/assessments/:assessmentId/files",
  upload.array("files", 20),
  studentClassesController.uploadAssessmentFiles,
);
router.delete(
  "/assessments/:assessmentId/files/:fileId",
  studentClassesController.removeAssessmentFile,
);
router.post(
  "/assessments/:assessmentId/submit",
  studentClassesController.submitAssessment,
);
router.get(
  "/assessments/:assessmentId/resources/:resourceId",
  studentClassesController.getAssessmentResource,
);

export default router;
