import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import { authorize } from "../../../common/middleware/authenticate.js";
import {
  uploadMiddleware,
  validateUploadedFiles,
} from "../../../common/middleware/upload-validation.js";
import { teacherAssessmentResourcesController } from "./teacher-assessment-resources.controller.js";

const router = Router();
const staffOnly = authorize(UserRole.SUPER_ADMIN, UserRole.OFFICE_STAFF, UserRole.STAFF);

router.get(
  "/tutor/assessments/:assessmentId/resources",
  staffOnly,
  teacherAssessmentResourcesController.list,
);
router.post(
  "/tutor/assessments/:assessmentId/resources",
  staffOnly,
  uploadMiddleware.array("files", 20),
  validateUploadedFiles,
  teacherAssessmentResourcesController.upload,
);
router.delete(
  "/tutor/assessments/:assessmentId/resources/:resourceId",
  staffOnly,
  teacherAssessmentResourcesController.remove,
);

export default router;
