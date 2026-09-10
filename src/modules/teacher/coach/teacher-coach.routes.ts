import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
} from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import { teacherCoachController } from "./teacher-coach.controller.js";
import {
  sendTeacherCoachMessageSchema,
  teacherCoachConversationQuerySchema,
  teacherCoachThreadIdParamsSchema,
} from "./teacher-coach.validation.js";

const router = Router();

router.use(authenticate, authorize(UserRole.STAFF));

router.get(
  "/conversation",
  validate(teacherCoachConversationQuerySchema, "query"),
  teacherCoachController.getConversation,
);
router.get("/threads", teacherCoachController.listThreads);
router.post("/threads", teacherCoachController.createThread);
router.delete(
  "/threads/:threadId",
  validate(teacherCoachThreadIdParamsSchema, "params"),
  teacherCoachController.deleteThread,
);
router.post(
  "/messages",
  validate(sendTeacherCoachMessageSchema),
  teacherCoachController.sendMessage,
);

export default router;
