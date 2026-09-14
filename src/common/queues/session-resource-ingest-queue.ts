import { Queue, Worker, type Job } from "bullmq";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

export type SessionResourceIngestJobPayload =
  | { type: "index-resource"; resourceId: string }
  | { type: "index-lesson"; sessionId: string };

const QUEUE_NAME = "session-resource-ingest";

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

let queue: Queue<SessionResourceIngestJobPayload> | null = null;
let worker: Worker<SessionResourceIngestJobPayload> | null = null;

export function getSessionResourceIngestQueue(): Queue<SessionResourceIngestJobPayload> {
  if (!queue) {
    queue = new Queue<SessionResourceIngestJobPayload>(QUEUE_NAME, {
      connection: redisConnection(),
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 200,
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
      },
    });
  }
  return queue;
}

async function replaceOrSkipJob(
  jobId: string,
  name: string,
  payload: SessionResourceIngestJobPayload,
) {
  const q = getSessionResourceIngestQueue();
  const existing = await q.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "active" || state === "waiting" || state === "delayed") {
      logger.info(
        { jobId, state, type: payload.type },
        "Session resource ingest job already queued — skipping duplicate",
      );
      return existing;
    }
    await existing.remove().catch(() => undefined);
  }
  return q.add(name, payload, { jobId });
}

async function processJob(job: Job<SessionResourceIngestJobPayload>) {
  const { sessionResourceIngestService } = await import(
    "../../modules/coach/session-resource-ingest.service.js"
  );
  const data = job.data;
  if (data.type === "index-resource") {
    await sessionResourceIngestService.indexResource(data.resourceId);
    return;
  }
  if (data.type === "index-lesson") {
    await sessionResourceIngestService.indexLesson(data.sessionId);
    return;
  }
  logger.warn({ data }, "Unknown session resource ingest job payload");
}

export function startSessionResourceIngestWorker() {
  if (worker) return worker;
  worker = new Worker<SessionResourceIngestJobPayload>(
    QUEUE_NAME,
    processJob,
    {
      connection: redisConnection(),
      concurrency: env.SYLLABUS_INGEST_WORKER_CONCURRENCY,
    },
  );
  worker.on("failed", (job, error) => {
    logger.error(
      { err: error, jobId: job?.id, data: job?.data },
      "Session resource ingest job failed",
    );
  });
  worker.on("completed", (job) => {
    logger.info(
      { jobId: job.id, data: job.data },
      "Session resource ingest job completed",
    );
  });
  logger.info(
    { concurrency: env.SYLLABUS_INGEST_WORKER_CONCURRENCY },
    "Session resource ingest worker started",
  );
  return worker;
}

export async function enqueueSessionResourceIndex(resourceId: string) {
  return replaceOrSkipJob(
    `session-resource-${resourceId}`,
    "index-resource",
    { type: "index-resource", resourceId },
  );
}

export async function enqueueSessionLessonIndex(sessionId: string) {
  return replaceOrSkipJob(`session-lesson-${sessionId}`, "index-lesson", {
    type: "index-lesson",
    sessionId,
  });
}
