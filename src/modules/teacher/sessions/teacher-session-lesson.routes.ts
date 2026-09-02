import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import { authorize } from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import {
  uploadMiddleware,
  validateUploadedFiles,
} from "../../../common/middleware/upload-validation.js";
import { teacherSessionLessonController } from "./teacher-session-lesson.controller.js";
import {
  sessionLessonParamsSchema,
  sessionLessonResourceParamsSchema,
  updateSessionResourceSchema,
  upsertSessionLessonSchema,
} from "./teacher-session-lesson.validation.js";

const router = Router();
const staffOnly = authorize(
  UserRole.SUPER_ADMIN,
  UserRole.OFFICE_STAFF,
  UserRole.STAFF,
);

router.get(
  "/tutor/sessions/:sessionId/workspace",
  staffOnly,
  validate(sessionLessonParamsSchema, "params"),
  teacherSessionLessonController.getWorkspace,
);

router.put(
  "/tutor/sessions/:sessionId/lesson",
  staffOnly,
  validate(sessionLessonParamsSchema, "params"),
  validate(upsertSessionLessonSchema),
  teacherSessionLessonController.upsertLesson,
);

router.get(
  "/tutor/sessions/:sessionId/resources",
  staffOnly,
  validate(sessionLessonParamsSchema, "params"),
  teacherSessionLessonController.listResources,
);

router.post(
  "/tutor/sessions/:sessionId/resources",
  staffOnly,
  validate(sessionLessonParamsSchema, "params"),
  uploadMiddleware.array("files", 20),
  validateUploadedFiles,
  teacherSessionLessonController.uploadResources,
);

router.patch(
  "/tutor/sessions/:sessionId/resources/:resourceId",
  staffOnly,
  validate(sessionLessonResourceParamsSchema, "params"),
  validate(updateSessionResourceSchema),
  teacherSessionLessonController.updateResource,
);

router.delete(
  "/tutor/sessions/:sessionId/resources/:resourceId",
  staffOnly,
  validate(sessionLessonResourceParamsSchema, "params"),
  teacherSessionLessonController.removeResource,
);

export default router;
