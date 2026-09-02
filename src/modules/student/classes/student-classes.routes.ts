import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
} from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import {
  uploadMiddleware,
  validateUploadedFiles,
} from "../../../common/middleware/upload-validation.js";
import { studentClassesController } from "./student-classes.controller.js";
import {
  studentSessionsPastQuerySchema,
  studentSessionsUpcomingQuerySchema,
} from "./student-classes.validation.js";

const router = Router();

router.use(authenticate, authorize(UserRole.STUDENT));

router.get("/sessions/subjects", studentClassesController.getSessionSubjects);
router.get(
  "/sessions/upcoming",
  validate(studentSessionsUpcomingQuerySchema, "query"),
  studentClassesController.listUpcomingSessions,
);
router.get(
  "/sessions/past",
  validate(studentSessionsPastQuerySchema, "query"),
  studentClassesController.listPastSessions,
);
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
  uploadMiddleware.array("files", 20),
  validateUploadedFiles,
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
  "/lessons/:sessionId/resources/:resourceId",
  studentClassesController.getSessionResource,
);
router.get(
  "/assessments/:assessmentId/submission",
  studentClassesController.getAssessmentSubmission,
);
router.post(
  "/assessments/:assessmentId/files",
  uploadMiddleware.array("files", 20),
  validateUploadedFiles,
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
