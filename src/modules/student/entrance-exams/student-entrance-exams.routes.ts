import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
} from "../../../common/middleware/authenticate.js";
import {
  uploadMiddleware,
  validateUploadedFiles,
} from "../../../common/middleware/upload-validation.js";
import { studentEntranceExamsController } from "./student-entrance-exams.controller.js";

const router = Router();

router.use(authenticate, authorize(UserRole.STUDENT));

router.get("/", studentEntranceExamsController.list);
router.get(
  "/:assessmentId/submission",
  studentEntranceExamsController.getSubmission,
);
router.post(
  "/:assessmentId/files",
  uploadMiddleware.array("files", 20),
  validateUploadedFiles,
  studentEntranceExamsController.upload,
);
router.delete(
  "/:assessmentId/files/:fileId",
  studentEntranceExamsController.removeFile,
);
router.post(
  "/:assessmentId/submit",
  studentEntranceExamsController.submit,
);

export default router;
