import { Router } from "express";
import multer from "multer";
import { UserRole } from "../../../common/constants/roles.js";
import { authorize } from "../../../common/middleware/authenticate.js";
import { teacherAssessmentResourcesController } from "./teacher-assessment-resources.controller.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 20 },
});

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
  upload.array("files", 20),
  teacherAssessmentResourcesController.upload,
);
router.delete(
  "/tutor/assessments/:assessmentId/resources/:resourceId",
  staffOnly,
  teacherAssessmentResourcesController.remove,
);

export default router;
