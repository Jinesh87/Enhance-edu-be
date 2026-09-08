import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
} from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import { adminAiController } from "./admin-ai.controller.js";
import {
  adminAiThreadIdParamsSchema,
  listAdminAiThreadsQuerySchema,
  sendAdminAiMessageSchema,
} from "./admin-ai.validation.js";

const router = Router();

router.use(
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.OFFICE_STAFF),
);

router.get(
  "/threads",
  validate(listAdminAiThreadsQuerySchema, "query"),
  adminAiController.listThreads,
);
router.post("/threads", adminAiController.createThread);
router.get(
  "/threads/:threadId",
  validate(adminAiThreadIdParamsSchema, "params"),
  adminAiController.getThread,
);
router.delete(
  "/threads/:threadId",
  validate(adminAiThreadIdParamsSchema, "params"),
  adminAiController.deleteThread,
);
router.post(
  "/messages",
  validate(sendAdminAiMessageSchema),
  adminAiController.sendMessage,
);

export default router;
