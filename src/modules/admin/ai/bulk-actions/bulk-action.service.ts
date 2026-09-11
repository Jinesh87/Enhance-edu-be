import { AppError } from "../../../../common/errors/AppError.js";
import type { AdminAiActor } from "../authorization.js";
import { communicationDraftService } from "../communications/communication-draft.service.js";
import {
  isAllowlistedBulkAction,
  type BulkActionType,
} from "./bulk-action-limits.js";

export class BulkActionService {
  assertAllowlisted(action: string): BulkActionType {
    if (!isAllowlistedBulkAction(action)) {
      throw new AppError(
        400,
        "This bulk action is not allowed.",
        "ADMIN_AI_BULK_ACTION_NOT_ALLOWLISTED",
      );
    }
    return action;
  }

  async preview(actor: AdminAiActor, draftId: string) {
    const draft = await communicationDraftService.previewAudience(
      actor,
      draftId,
    );
    return {
      ...draft,
      action: this.assertAllowlisted(draft.action ?? "send_email"),
      dryRun: true as const,
    };
  }

  async confirm(
    actor: AdminAiActor,
    draftId: string,
    input: {
      password?: string;
      subject?: string;
      body?: string;
      retryFailedOnly?: boolean;
      selectedUserIds?: string[] | null;
      attachments?: unknown;
      confirmationText?: string;
      action?: string;
    },
  ) {
    this.assertAllowlisted(input.action ?? "send_email");
    return communicationDraftService.confirmSend(actor, draftId, input);
  }

  async status(actor: AdminAiActor, draftId: string) {
    const draft = await communicationDraftService.get(actor, draftId);
    return {
      draftId: draft.draftId,
      action: draft.action ?? "send_email",
      status: draft.status,
      audienceLabel: draft.audienceLabel,
      recipientCount: draft.recipientCount,
      sendableCount: draft.sendableCount,
      sentCount: draft.sentCount,
      failedCount: draft.failedCount,
      skippedCount: draft.skippedCount ?? 0,
      processedCount: draft.processedCount ?? 0,
      withinLimit: draft.withinLimit,
      limitMessage: draft.limitMessage,
      requiresTypeConfirm: draft.requiresTypeConfirm,
      typeConfirmPhrase: draft.typeConfirmPhrase,
      updatedAt: draft.updatedAt,
    };
  }

  async retryFailed(
    actor: AdminAiActor,
    draftId: string,
    input: { password?: string; confirmationText?: string } = {},
  ) {
    return this.confirm(actor, draftId, {
      ...input,
      action: "send_email",
      retryFailedOnly: true,
    });
  }
}

export const bulkActionService = new BulkActionService();
