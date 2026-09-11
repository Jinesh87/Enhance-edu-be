import { Queue, Worker, type Job } from "bullmq";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { redis } from "../../config/redis.js";
import { AppDataSource } from "../../config/data-source.js";
import { UserRole } from "../constants/roles.js";
import { AdminAiCommunicationDraft } from "../../entities/AdminAiCommunicationDraft.js";
import { communicationSendService } from "../../modules/admin/ai/communications/communication-send.service.js";
import type { AdminAiActor } from "../../modules/admin/ai/authorization.js";
import { BULK_SEND_CONCURRENCY } from "../../modules/admin/ai/bulk-actions/bulk-action-limits.js";

export type BulkActionJobPayload = {
  draftId: string;
  action: "send_email";
  requestedBy: string;
  idempotencyKey: string;
  retryFailedOnly: boolean;
};

const QUEUE_NAME = "bulk-actions";
const ATTACH_KEY_PREFIX = "admin-ai-bulk-attach:";

function redisConnection() {
  const url = new URL(env.REDIS_URL);
  const password = url.password ? decodeURIComponent(url.password) : undefined;
  const username = url.username ? decodeURIComponent(url.username) : undefined;
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    maxRetriesPerRequest: null as null,
  };
}

let queue: Queue<BulkActionJobPayload> | null = null;
let worker: Worker<BulkActionJobPayload> | null = null;

export function getBulkActionsQueue(): Queue<BulkActionJobPayload> {
  if (!queue) {
    queue = new Queue<BulkActionJobPayload>(QUEUE_NAME, {
      connection: redisConnection(),
      defaultJobOptions: {
        removeOnComplete: 200,
        removeOnFail: 300,
        attempts: 2,
        backoff: { type: "exponential", delay: 8_000 },
      },
    });
  }
  return queue;
}

export async function storeBulkActionAttachments(
  draftId: string,
  attachments: Array<{ filename: string; content: Buffer }>,
) {
  if (!attachments.length) {
    await redis.del(`${ATTACH_KEY_PREFIX}${draftId}`);
    return;
  }
  const payload = attachments.map((file) => ({
    filename: file.filename,
    contentBase64: file.content.toString("base64"),
  }));
  await redis.setex(
    `${ATTACH_KEY_PREFIX}${draftId}`,
    60 * 60,
    JSON.stringify(payload),
  );
}

async function loadBulkActionAttachments(draftId: string) {
  const raw = await redis.get(`${ATTACH_KEY_PREFIX}${draftId}`);
  if (!raw) return [] as Array<{ filename: string; content: Buffer }>;
  try {
    const parsed = JSON.parse(raw) as Array<{
      filename?: string;
      contentBase64?: string;
    }>;
    return parsed
      .filter((row) => row.filename && row.contentBase64)
      .map((row) => ({
        filename: String(row.filename).slice(0, 180),
        content: Buffer.from(String(row.contentBase64), "base64"),
      }));
  } catch {
    return [];
  }
}

async function clearBulkActionAttachments(draftId: string) {
  await redis.del(`${ATTACH_KEY_PREFIX}${draftId}`);
}

export async function enqueueBulkActionJob(payload: BulkActionJobPayload) {
  const jobId = `bulk-${payload.draftId}-${payload.idempotencyKey}`;
  await getBulkActionsQueue().add("send_email", payload, { jobId });
  return jobId;
}

async function processJob(job: Job<BulkActionJobPayload>) {
  const { draftId, requestedBy, retryFailedOnly } = job.data;
  const drafts = AppDataSource.getRepository(AdminAiCommunicationDraft);
  const draft = await drafts.findOne({ where: { id: draftId } });
  if (!draft) {
    logger.warn({ draftId }, "Bulk action job: draft missing");
    return;
  }
  if (draft.ownerUserId !== requestedBy) {
    logger.warn({ draftId, requestedBy }, "Bulk action job: owner mismatch");
    return;
  }

  const claimed = await drafts
    .createQueryBuilder()
    .update(AdminAiCommunicationDraft)
    .set({ status: "sending" })
    .where("id = :id AND status = :status", { id: draftId, status: "queued" })
    .execute();

  if (!claimed.affected) {
    logger.info({ draftId, status: draft.status }, "Bulk action skip claim");
    return;
  }

  const actor: AdminAiActor = {
    id: requestedBy,
    email: "",
    role: UserRole.OFFICE_STAFF,
    modulePermissions: [],
  };

  const attachments = retryFailedOnly
    ? []
    : await loadBulkActionAttachments(draftId);

  try {
    await communicationSendService.sendDraft(actor, draftId, {
      retryFailedOnly,
      attachments,
    });
  } finally {
    if (!retryFailedOnly) {
      await clearBulkActionAttachments(draftId);
    }
  }
}

export function startBulkActionsWorker() {
  if (worker) return worker;
  worker = new Worker<BulkActionJobPayload>(QUEUE_NAME, processJob, {
    connection: redisConnection(),
    concurrency: Math.max(
      1,
      Number(
        process.env.BULK_ACTIONS_WORKER_CONCURRENCY ?? BULK_SEND_CONCURRENCY,
      ) || BULK_SEND_CONCURRENCY,
    ),
  });
  worker.on("failed", (job, error) => {
    logger.error(
      { err: error, jobId: job?.id, draftId: job?.data.draftId },
      "Bulk action job failed",
    );
    if (!job?.data.draftId) return;
    void AppDataSource.getRepository(AdminAiCommunicationDraft)
      .createQueryBuilder()
      .update(AdminAiCommunicationDraft)
      .set({ status: "failed" })
      .where("id = :id AND status IN (:...statuses)", {
        id: job.data.draftId,
        statuses: ["queued", "sending"],
      })
      .execute()
      .catch((err) =>
        logger.warn(
          { err, draftId: job.data.draftId },
          "Failed to mark draft failed after job error",
        ),
      );
  });
  logger.info("Admin AI bulk-actions worker started");
  return worker;
}
