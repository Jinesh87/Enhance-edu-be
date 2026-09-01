import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import { authorize } from "../../../common/middleware/authenticate.js";
import {
  uploadMiddleware,
  validateUploadedFiles,
} from "../../../common/middleware/upload-validation.js";
import { validate } from "../../../common/middleware/validate.js";
import { teacherHomeworkController } from "./teacher-homework.controller.js";
import {
  createTeacherHomeworkSchema,
  gradeTeacherHomeworkSubmissionSchema,
  updateTeacherHomeworkSchema,
} from "./teacher-homework.validation.js";

const router = Router();
const staffOnly = authorize(
  UserRole.SUPER_ADMIN,
  UserRole.OFFICE_STAFF,
  UserRole.STAFF,
);

router.get("/tutor/homework/lookups", staffOnly, teacherHomeworkController.lookups);
router.get("/tutor/homework", staffOnly, teacherHomeworkController.list);
router.get(
  "/tutor/homework/:homeworkId/attachments/:attachmentId",
  staffOnly,
  teacherHomeworkController.getAttachment,
);
router.post(
  "/tutor/homework",
  staffOnly,
  uploadMiddleware.array("files", 20),
  validateUploadedFiles,
  validate(createTeacherHomeworkSchema),
  teacherHomeworkController.create,
);
router.put(
  "/tutor/homework/:homeworkId",
  staffOnly,
  uploadMiddleware.array("files", 20),
  validateUploadedFiles,
  validate(updateTeacherHomeworkSchema),
  teacherHomeworkController.update,
);
router.get(
  "/tutor/homework/:homeworkId/submissions",
  staffOnly,
  teacherHomeworkController.listSubmissions,
);
router.get(
  "/tutor/homework/:homeworkId/submissions/:submissionId/files/:fileId",
  staffOnly,
  teacherHomeworkController.getSubmissionFile,
);
router.post(
  "/tutor/homework/:homeworkId/submissions/:studentId/grade",
  staffOnly,
  validate(gradeTeacherHomeworkSubmissionSchema),
  teacherHomeworkController.gradeSubmission,
);
router.delete(
  "/tutor/homework/:homeworkId",
  staffOnly,
  teacherHomeworkController.delete,
);

export default router;
