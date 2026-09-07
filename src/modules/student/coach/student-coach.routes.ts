import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
} from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import { studentCoachController } from "./student-coach.controller.js";
import {
  coachConversationQuerySchema,
  coachThreadIdParamsSchema,
  sendCoachMessageSchema,
} from "./student-coach.validation.js";

const router = Router();

router.use(authenticate, authorize(UserRole.STUDENT));

router.get(
  "/conversation",
  validate(coachConversationQuerySchema, "query"),
  studentCoachController.getConversation,
);
router.get("/threads", studentCoachController.listThreads);
router.post("/threads", studentCoachController.createThread);
router.delete(
  "/threads/:threadId",
  validate(coachThreadIdParamsSchema, "params"),
  studentCoachController.deleteThread,
);
router.post(
  "/messages",
  validate(sendCoachMessageSchema),
  studentCoachController.sendMessage,
);

export default router;
