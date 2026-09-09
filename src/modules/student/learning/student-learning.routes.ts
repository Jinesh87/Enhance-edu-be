import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
} from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import { studentLearningController } from "./student-learning.controller.js";
import {
  flashcardProgressSchema,
  submitQuizAnswersSchema,
} from "./student-learning.validation.js";

const router = Router();

router.use(authenticate);
router.use(authorize(UserRole.STUDENT));

router.get("/", studentLearningController.list);
router.get("/sets/:setId", studentLearningController.getSet);
router.get("/sets/:setId/leaderboard", studentLearningController.leaderboard);
router.post(
  "/flashcards/:flashcardId/progress",
  validate(flashcardProgressSchema),
  studentLearningController.updateFlashcardProgress,
);
router.post("/sets/:setId/attempts", studentLearningController.startAttempt);
router.post(
  "/attempts/:attemptId/complete",
  validate(submitQuizAnswersSchema),
  studentLearningController.completeAttempt,
);
router.get(
  "/attempts/:attemptId/result",
  studentLearningController.getAttemptResult,
);

export default router;
