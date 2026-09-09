import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import { authorize } from "../../../common/middleware/authenticate.js";
import {
  uploadMiddleware,
  validateUploadedFiles,
} from "../../../common/middleware/upload-validation.js";
import { validate } from "../../../common/middleware/validate.js";
import { teacherLearningController } from "./teacher-learning.controller.js";
import {
  createLearningSetSchema,
  generateLearningSetSchema,
  updateLearningSetSchema,
  upsertFlashcardSchema,
  updateFlashcardSchema,
  upsertQuizQuestionSchema,
  upsertRevisionSchema,
  updateRevisionSchema,
} from "./teacher-learning.validation.js";

const router = Router();
const staffOnly = authorize(
  UserRole.SUPER_ADMIN,
  UserRole.OFFICE_STAFF,
  UserRole.STAFF,
);

router.get(
  "/tutor/learning-tools/lookups",
  staffOnly,
  teacherLearningController.lookups,
);
router.get("/tutor/learning-sets", staffOnly, teacherLearningController.list);
router.get(
  "/tutor/learning-sets/:setId",
  staffOnly,
  teacherLearningController.get,
);
router.post(
  "/tutor/learning-sets",
  staffOnly,
  uploadMiddleware.array("file", 1),
  validateUploadedFiles,
  validate(createLearningSetSchema),
  teacherLearningController.create,
);
router.patch(
  "/tutor/learning-sets/:setId",
  staffOnly,
  validate(updateLearningSetSchema),
  teacherLearningController.update,
);
router.delete(
  "/tutor/learning-sets/:setId",
  staffOnly,
  teacherLearningController.remove,
);
router.post(
  "/tutor/learning-sets/:setId/generate",
  staffOnly,
  validate(generateLearningSetSchema),
  teacherLearningController.generate,
);
router.post(
  "/tutor/learning-sets/:setId/publish",
  staffOnly,
  teacherLearningController.publish,
);
router.post(
  "/tutor/learning-sets/:setId/unpublish",
  staffOnly,
  teacherLearningController.unpublish,
);

router.post(
  "/tutor/learning-sets/:setId/flashcards",
  staffOnly,
  validate(upsertFlashcardSchema),
  teacherLearningController.addFlashcard,
);
router.patch(
  "/tutor/learning-flashcards/:flashcardId",
  staffOnly,
  validate(updateFlashcardSchema),
  teacherLearningController.updateFlashcard,
);
router.delete(
  "/tutor/learning-flashcards/:flashcardId",
  staffOnly,
  teacherLearningController.deleteFlashcard,
);

router.post(
  "/tutor/learning-sets/:setId/quiz-questions",
  staffOnly,
  validate(upsertQuizQuestionSchema),
  teacherLearningController.addQuizQuestion,
);
router.patch(
  "/tutor/learning-quiz-questions/:questionId",
  staffOnly,
  teacherLearningController.updateQuizQuestion,
);
router.delete(
  "/tutor/learning-quiz-questions/:questionId",
  staffOnly,
  teacherLearningController.deleteQuizQuestion,
);

router.post(
  "/tutor/learning-sets/:setId/revision-questions",
  staffOnly,
  validate(upsertRevisionSchema),
  teacherLearningController.addRevision,
);
router.patch(
  "/tutor/learning-revision-questions/:revisionId",
  staffOnly,
  validate(updateRevisionSchema),
  teacherLearningController.updateRevision,
);
router.delete(
  "/tutor/learning-revision-questions/:revisionId",
  staffOnly,
  teacherLearningController.deleteRevision,
);

router.get(
  "/tutor/learning-sets/:setId/leaderboard",
  staffOnly,
  teacherLearningController.leaderboard,
);
router.get(
  "/tutor/learning-sets/:setId/attempts",
  staffOnly,
  teacherLearningController.listAttempts,
);
router.get(
  "/tutor/learning-sets/:setId/student-activity",
  staffOnly,
  teacherLearningController.getStudentActivity,
);
router.get(
  "/tutor/learning-attempts/:attemptId",
  staffOnly,
  teacherLearningController.getAttemptReview,
);

export default router;
