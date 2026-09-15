import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
} from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import {
  uploadMiddleware,
  validateUploadedChatImages,
} from "../../../common/middleware/upload-validation.js";
import { chatController } from "./chat.controller.js";
import {
  conversationIdParamsSchema,
  listMessagesQuerySchema,
  messageMediaParamsSchema,
  openConversationSchema,
  searchChatQuerySchema,
  sendChatMessageSchema,
} from "./chat.validation.js";

const router = Router();

router.use(authenticate, authorize(UserRole.STUDENT, UserRole.STAFF));

router.get("/contacts", chatController.listContacts);
router.get("/conversations", chatController.listConversations);
router.get(
  "/search",
  validate(searchChatQuerySchema, "query"),
  chatController.search,
);
router.post(
  "/conversations",
  validate(openConversationSchema),
  chatController.openConversation,
);
router.get(
  "/conversations/:conversationId/messages",
  validate(conversationIdParamsSchema, "params"),
  validate(listMessagesQuerySchema, "query"),
  chatController.listMessages,
);
router.post(
  "/conversations/:conversationId/messages",
  validate(conversationIdParamsSchema, "params"),
  uploadMiddleware.array("files", 1),
  validateUploadedChatImages,
  validate(sendChatMessageSchema),
  chatController.sendMessage,
);
router.get(
  "/conversations/:conversationId/messages/:messageId/media",
  validate(messageMediaParamsSchema, "params"),
  chatController.getMessageMedia,
);
router.post(
  "/conversations/:conversationId/read",
  validate(conversationIdParamsSchema, "params"),
  chatController.markRead,
);
router.get("/unread-count", chatController.unreadCount);

export default router;
