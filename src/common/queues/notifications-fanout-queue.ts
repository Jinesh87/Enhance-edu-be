import { Queue, Worker, type Job } from "bullmq";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { userNotificationManager } from "../../modules/notifications/notification-updates.js";
import { pushSubscriptionService } from "../../modules/notifications/push.service.js";
import {
  notificationsService,
  type NotificationDto,
} from "../../modules/notifications/notifications.service.js";

export type NotificationFanoutTarget = {
  userId: string;
  notification: NotificationDto;
};

export type NotificationFanoutJobPayload = {
  targets: NotificationFanoutTarget[];
};

const QUEUE_NAME = "notifications-fanout";
const CHUNK_SIZE = 40;

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

let queue: Queue<NotificationFanoutJobPayload> | null = null;
let worker: Worker<NotificationFanoutJobPayload> | null = null;

function chunkTargets<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export function getNotificationsFanoutQueue(): Queue<NotificationFanoutJobPayload> {
  if (!queue) {
    queue = new Queue<NotificationFanoutJobPayload>(QUEUE_NAME, {
      connection: redisConnection(),
      defaultJobOptions: {
        removeOnComplete: 500,
        removeOnFail: 500,
        attempts: 3,
        backoff: { type: "exponential", delay: 2_000 },
      },
    });
  }
  return queue;
}

export async function deliverNotificationFanout(
  targets: NotificationFanoutTarget[],
): Promise<void> {
  if (targets.length === 0) return;

  const unreadByUser = new Map<string, number>();
  for (const target of targets) {
    if (!unreadByUser.has(target.userId)) {
      unreadByUser.set(
        target.userId,
        await notificationsService.countUnread(target.userId),
      );
    }
    userNotificationManager.publish({
      userId: target.userId,
      type: "NOTIFICATION_CREATED",
      unreadCount: unreadByUser.get(target.userId) ?? 0,
      notification: target.notification,
    });
  }

  await pushSubscriptionService.sendNotificationTargets(targets);
}

async function processJob(job: Job<NotificationFanoutJobPayload>) {
  await deliverNotificationFanout(job.data.targets ?? []);
}

export async function enqueueNotificationFanout(
  targets: NotificationFanoutTarget[],
): Promise<void> {
  if (targets.length === 0) return;

  const chunks = chunkTargets(targets, CHUNK_SIZE);
  try {
    const q = getNotificationsFanoutQueue();
    await Promise.all(
      chunks.map((chunk, index) =>
        q.add(
          "fanout",
          { targets: chunk },
          {
            jobId: `nf-${chunk[0]!.notification.id}-${index}-${Date.now()}`,
          },
        ),
      ),
    );
  } catch (error) {
    logger.warn(
      { err: error, targetCount: targets.length },
      "Notification fan-out enqueue failed; delivering inline",
    );
    await deliverNotificationFanout(targets);
  }
}

export function startNotificationsFanoutWorker() {
  if (worker) return worker;
  worker = new Worker<NotificationFanoutJobPayload>(QUEUE_NAME, processJob, {
    connection: redisConnection(),
    concurrency: 5,
  });
  worker.on("failed", (job, error) => {
    logger.error(
      {
        err: error,
        jobId: job?.id,
        targetCount: job?.data.targets?.length ?? 0,
      },
      "Notification fan-out job failed",
    );
  });
  logger.info("Notifications fan-out worker started");
  return worker;
}
