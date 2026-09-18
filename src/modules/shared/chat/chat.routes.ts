import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
} from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import {
  uploadMiddleware,
  validateUploadedChatAttachments,
} from "../../../common/middleware/upload-validation.js";
import { chatController } from "./chat.controller.js";
import {
  conversationIdParamsSchema,
  editChatMessageSchema,
  listMessagesQuerySchema,
  listConversationMediaQuerySchema,
  messageMediaParamsSchema,
  messageMediaQuerySchema,
  muteConversationSchema,
  openConversationSchema,
  searchChatQuerySchema,
  searchConversationMessagesQuerySchema,
  sendChatMessageSchema,
} from "./chat.validation.js";

const router = Router();

router.use(
  authenticate,
  authorize(UserRole.STUDENT, UserRole.STAFF, UserRole.GUARDIAN, UserRole.SUPER_ADMIN),
);

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
router.get(
  "/conversations/:conversationId/media",
  validate(conversationIdParamsSchema, "params"),
  validate(listConversationMediaQuerySchema, "query"),
  chatController.listMedia,
);
router.post(
  "/conversations/:conversationId/clear",
  validate(conversationIdParamsSchema, "params"),
  chatController.clearConversation,
);
router.get(
  "/conversations/:conversationId/messages/search",
  validate(conversationIdParamsSchema, "params"),
  validate(searchConversationMessagesQuerySchema, "query"),
  chatController.searchInConversation,
);
router.post(
  "/conversations/:conversationId/messages",
  validate(conversationIdParamsSchema, "params"),
  uploadMiddleware.array("files", 1),
  validateUploadedChatAttachments,
  validate(sendChatMessageSchema),
  chatController.sendMessage,
);
router.get(
  "/conversations/:conversationId/messages/:messageId/media",
  validate(messageMediaParamsSchema, "params"),
  validate(messageMediaQuerySchema, "query"),
  chatController.getMessageMedia,
);
router.post(
  "/conversations/:conversationId/read",
  validate(conversationIdParamsSchema, "params"),
  chatController.markRead,
);
router.delete(
  "/conversations/:conversationId/messages/:messageId",
  validate(messageMediaParamsSchema, "params"),
  chatController.deleteMessage,
);
router.patch(
  "/conversations/:conversationId/messages/:messageId",
  validate(messageMediaParamsSchema, "params"),
  validate(editChatMessageSchema),
  chatController.editMessage,
);
router.post(
  "/conversations/:conversationId/mute",
  validate(conversationIdParamsSchema, "params"),
  validate(muteConversationSchema),
  chatController.setMuted,
);
router.post(
  "/conversations/:conversationId/messages/:messageId/voice-played",
  validate(messageMediaParamsSchema, "params"),
  chatController.markVoicePlayed,
);
router.get("/unread-count", chatController.unreadCount);

export default router;
