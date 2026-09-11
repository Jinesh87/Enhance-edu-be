import { randomUUID } from "crypto";
import { AppDataSource } from "../../../../config/data-source.js";
import { AppError } from "../../../../common/errors/AppError.js";
import { logger } from "../../../../config/logger.js";
import {
  AdminAiCommunicationDraft,
  type CommunicationRecipientSnapshot,
} from "../../../../entities/AdminAiCommunicationDraft.js";
import { emailService } from "../../../email/email.service.js";
import { writeAdminAiAudit } from "../audit.js";
import type { AdminAiActor } from "../authorization.js";
import {
  loadDeliveryEmailsByUserId,
  sanitizeRecipientsForStorage,
} from "./audience.privacy.js";

const SEND_CONCURRENCY = 5;

async function mapPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let index = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (index < items.length) {
        const current = index;
        index += 1;
        await worker(items[current]!);
      }
    },
  );
  await Promise.all(runners);
}

export class CommunicationSendService {
  private readonly drafts = AppDataSource.getRepository(
    AdminAiCommunicationDraft,
  );

  async sendDraft(
    actor: AdminAiActor,
    draftId: string,
    options: {
      retryFailedOnly: boolean;
      attachments?: Array<{ filename: string; content: Buffer }>;
    },
  ) {
    const draft = await this.drafts.findOne({
      where: { id: draftId, ownerUserId: actor.id },
    });
    if (!draft) {
      throw new AppError(
        404,
        "Communication draft not found",
        "ADMIN_AI_COMM_DRAFT_NOT_FOUND",
      );
    }
    if (draft.status !== "sending") {
      throw new AppError(
        409,
        "This message is not ready to send.",
        "ADMIN_AI_COMM_NOT_SENDING",
      );
    }

    // Never persist raw emails — normalize any legacy snapshot rows first.
    const snapshot = sanitizeRecipientsForStorage([
      ...(draft.recipientsSnapshot ?? []),
    ]);

    const deliveryEmails = await loadDeliveryEmailsByUserId(
      snapshot.map((row) => row.userId),
    );

    // Refresh hasEmail from live users at send time.
    for (const row of snapshot) {
      row.hasEmail = deliveryEmails.has(row.userId);
    }

    const targets = options.retryFailedOnly
      ? snapshot.filter((row) => row.status === "failed")
      : snapshot.filter(
          (row) =>
            row.selected !== false &&
            row.hasEmail &&
            row.status !== "sent",
        );

    if (!options.retryFailedOnly) {
      for (const row of snapshot) {
        if (row.selected === false && row.status === "pending") {
          row.status = "skipped";
          row.errorReason = "Deselected by admin";
          continue;
        }
        if (!row.hasEmail && row.status === "pending") {
          row.status = "skipped";
          row.errorReason = "No email on file";
        }
      }
    }

    await mapPool(targets, SEND_CONCURRENCY, async (target) => {
      const row = snapshot.find((item) => item.userId === target.userId);
      if (!row) return;

      const to = deliveryEmails.get(row.userId)?.trim();
      if (!to) {
        row.status = "failed";
        row.hasEmail = false;
        row.errorReason = "No email on file";
        return;
      }

      try {
        const personalizedBody = personalizeBody(draft.body, row);
        const providerId = await emailService.sendAdminCommunicationEmail({
          to,
          fullName: row.name,
          subject: draft.subject,
          bodyText: personalizedBody,
          attachments: options.attachments,
        });
        row.status = "sent";
        row.errorReason = null;
        row.providerMessageId = providerId;
      } catch (error) {
        row.status = "failed";
        row.errorReason = humanizeSendError(error);
        // Log userId only — never log the destination email address.
        logger.warn(
          { err: error, draftId: draft.id, userId: row.userId },
          "Admin AI communication send failed for recipient",
        );
      }
    });

    const sentCount = snapshot.filter((row) => row.status === "sent").length;
    const failedCount = snapshot.filter((row) => row.status === "failed").length;
    const attempted = snapshot.filter(
      (row) => row.status === "sent" || row.status === "failed",
    ).length;

    let status: AdminAiCommunicationDraft["status"] = "sent";
    if (failedCount > 0 && sentCount > 0) status = "partially_sent";
    else if (failedCount > 0 && sentCount === 0) status = "failed";
    else if (attempted === 0) status = "failed";

    draft.recipientsSnapshot = sanitizeRecipientsForStorage(snapshot);
    draft.sentCount = sentCount;
    draft.failedCount = failedCount;
    draft.status = status;
    await this.drafts.save(draft);

    await writeAdminAiAudit({
      requestId: randomUUID().replace(/-/g, "").slice(0, 32),
      actor,
      conversationId: draft.threadId,
      eventType:
        status === "sent"
          ? "AI_COMM_SEND_COMPLETED"
          : status === "partially_sent"
            ? "AI_COMM_SEND_PARTIAL"
            : "AI_COMM_SEND_FAILED",
      scopeMetadata: {
        draftId: draft.id,
        sentCount,
        failedCount,
        recipientCount: draft.recipientCount,
      },
      resultStatus: status === "failed" ? "failed" : "ok",
    });

    return {
      draftId: draft.id,
      status: draft.status,
      recipientCount: draft.recipientCount,
      sentCount,
      failedCount,
      failures: snapshot
        .filter((row) => row.status === "failed")
        .slice(0, 20)
        .map((row) => ({
          name: row.name,
          errorReason: row.errorReason ?? "Send failed",
        })),
    };
  }
}

function personalizeBody(
  body: string,
  recipient: CommunicationRecipientSnapshot,
): string {
  const students = (recipient.studentNames ?? []).join(", ") || "your student";
  return body
    .replaceAll("{{guardianName}}", recipient.name)
    .replaceAll("{{studentNames}}", students)
    .replaceAll("{{parentName}}", recipient.name);
}

function humanizeSendError(error: unknown): string {
  if (error instanceof AppError) {
    if (error.code === "EMAIL_NOT_CONFIGURED") return "Email is not configured";
    if (error.code === "EMAIL_DISABLED") return "Email sending is disabled";
    if (error.code.startsWith("EMAIL_")) return "Email provider rejected the message";
    return error.message.slice(0, 160);
  }
  return "Temporary send error";
}

export const communicationSendService = new CommunicationSendService();
