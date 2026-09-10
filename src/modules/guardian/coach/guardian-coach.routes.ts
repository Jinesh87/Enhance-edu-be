import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
} from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import { guardianCoachController } from "./guardian-coach.controller.js";
import {
  guardianCoachConversationQuerySchema,
  guardianCoachThreadIdParamsSchema,
  sendGuardianCoachMessageSchema,
} from "./guardian-coach.validation.js";

const router = Router();

router.use(authenticate, authorize(UserRole.GUARDIAN));

router.get(
  "/conversation",
  validate(guardianCoachConversationQuerySchema, "query"),
  guardianCoachController.getConversation,
);
router.get("/threads", guardianCoachController.listThreads);
router.post("/threads", guardianCoachController.createThread);
router.delete(
  "/threads/:threadId",
  validate(guardianCoachThreadIdParamsSchema, "params"),
  guardianCoachController.deleteThread,
);
router.post(
  "/messages",
  validate(sendGuardianCoachMessageSchema),
  guardianCoachController.sendMessage,
);

export default router;
