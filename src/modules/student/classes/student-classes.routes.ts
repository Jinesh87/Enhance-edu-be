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
router.get("/homework", studentClassesController.listHomework);
router.get(
  "/homework/:homeworkId/attachments/:attachmentId",
  studentClassesController.getHomeworkAttachment,
);
router.get(
  "/homework/:homeworkId/submission",
  studentClassesController.getHomeworkSubmission,
);
router.post(
  "/homework/:homeworkId/files",
  upload.array("files", 20),
  studentClassesController.uploadHomeworkFiles,
);
router.delete(
  "/homework/:homeworkId/files/:fileId",
  studentClassesController.removeHomeworkFile,
);
router.post(
  "/homework/:homeworkId/submit",
  studentClassesController.submitHomework,
);
router.get(
  "/homework/:homeworkId/submission-files/:fileId",
  studentClassesController.getHomeworkSubmissionFile,
);
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
