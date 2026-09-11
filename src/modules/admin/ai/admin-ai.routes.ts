import { Router } from "express";
import { UserRole } from "../../../common/constants/roles.js";
import {
  authenticate,
  authorize,
} from "../../../common/middleware/authenticate.js";
import { validate } from "../../../common/middleware/validate.js";
import { adminAiController } from "./admin-ai.controller.js";
import {
  adminAiBulkActionIdParamsSchema,
  adminAiDraftIdParamsSchema,
  adminAiMemoryIdParamsSchema,
  adminAiReportIdParamsSchema,
  adminAiThreadIdParamsSchema,
  confirmBulkActionSchema,
  confirmSendCommunicationSchema,
  listAdminAiThreadsQuerySchema,
  previewBulkActionSchema,
  retryFailedBulkActionSchema,
  sendAdminAiMessageSchema,
  updateCommunicationDraftSchema,
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
router.get("/memories", adminAiController.listMemories);
router.delete(
  "/memories/:memoryId",
  validate(adminAiMemoryIdParamsSchema, "params"),
  adminAiController.deleteMemory,
);
router.post(
  "/reports/drafts/:draftId/generate",
  validate(adminAiDraftIdParamsSchema, "params"),
  adminAiController.confirmGenerateReport,
);
router.get(
  "/reports/:reportId/download",
  validate(adminAiReportIdParamsSchema, "params"),
  adminAiController.downloadReport,
);
router.get(
  "/communications/drafts/:draftId",
  validate(adminAiDraftIdParamsSchema, "params"),
  adminAiController.getCommunicationDraft,
);
router.get(
  "/communications/drafts/:draftId/recipients",
  validate(adminAiDraftIdParamsSchema, "params"),
  adminAiController.listCommunicationRecipients,
);
router.patch(
  "/communications/drafts/:draftId",
  validate(adminAiDraftIdParamsSchema, "params"),
  validate(updateCommunicationDraftSchema),
  adminAiController.updateCommunicationDraft,
);
router.post(
  "/communications/drafts/:draftId/confirm-send",
  validate(adminAiDraftIdParamsSchema, "params"),
  validate(confirmSendCommunicationSchema),
  adminAiController.confirmSendCommunication,
);
router.post(
  "/bulk-actions/preview",
  validate(previewBulkActionSchema),
  adminAiController.previewBulkAction,
);
router.post(
  "/bulk-actions/:id/confirm",
  validate(adminAiBulkActionIdParamsSchema, "params"),
  validate(confirmBulkActionSchema),
  adminAiController.confirmBulkAction,
);
router.get(
  "/bulk-actions/:id/status",
  validate(adminAiBulkActionIdParamsSchema, "params"),
  adminAiController.getBulkActionStatus,
);
router.post(
  "/bulk-actions/:id/retry-failed",
  validate(adminAiBulkActionIdParamsSchema, "params"),
  validate(retryFailedBulkActionSchema),
  adminAiController.retryFailedBulkAction,
);
router.post(
  "/messages",
  validate(sendAdminAiMessageSchema),
  adminAiController.sendMessage,
);
router.post(
  "/messages/stream",
  validate(sendAdminAiMessageSchema),
  adminAiController.sendMessageStream,
);

export default router;
