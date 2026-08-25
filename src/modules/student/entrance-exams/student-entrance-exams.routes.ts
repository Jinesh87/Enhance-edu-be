import { Router } from "express";
import multer from "multer";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
} from "../../../common/middleware/authenticate.js";
import { studentEntranceExamsController } from "./student-entrance-exams.controller.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 20 },
});

const router = Router();

router.use(authenticate, authorize(UserRole.STUDENT));

router.get("/", studentEntranceExamsController.list);
router.get(
  "/:assessmentId/submission",
  studentEntranceExamsController.getSubmission,
);
router.post(
  "/:assessmentId/files",
  upload.array("files", 20),
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
