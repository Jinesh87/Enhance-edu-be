import { Queue, Worker, type Job } from "bullmq";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

export type SyllabusIngestJobPayload =
  | { type: "reindex-syllabus"; syllabusId: string }
  | { type: "index-document"; documentId: string };

const QUEUE_NAME = "syllabus-ingest";

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

let queue: Queue<SyllabusIngestJobPayload> | null = null;
let worker: Worker<SyllabusIngestJobPayload> | null = null;

export function getSyllabusIngestQueue(): Queue<SyllabusIngestJobPayload> {
  if (!queue) {
    queue = new Queue<SyllabusIngestJobPayload>(QUEUE_NAME, {
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
  payload: SyllabusIngestJobPayload,
) {
  const q = getSyllabusIngestQueue();
  const existing = await q.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "active" || state === "waiting" || state === "delayed") {
      logger.info(
        { jobId, state, type: payload.type },
        "Syllabus ingest job already queued — skipping duplicate",
      );
      return existing;
    }
    await existing.remove().catch(() => undefined);
  }
  return q.add(name, payload, { jobId });
}

async function processJob(job: Job<SyllabusIngestJobPayload>) {
  // Dynamic import avoids a circular dependency with syllabus-ingest.service.
  const { syllabusIngestService } = await import(
    "../../modules/coach/syllabus-ingest.service.js"
  );
  const data = job.data;
  if (data.type === "reindex-syllabus") {
    await syllabusIngestService.reindexSyllabus(data.syllabusId);
    return;
  }
  if (data.type === "index-document") {
    await syllabusIngestService.indexDocument(data.documentId);
    return;
  }
  logger.warn({ data }, "Unknown syllabus ingest job payload");
}

export function startSyllabusIngestWorker() {
  if (worker) return worker;
  worker = new Worker<SyllabusIngestJobPayload>(QUEUE_NAME, processJob, {
    connection: redisConnection(),
    concurrency: env.SYLLABUS_INGEST_WORKER_CONCURRENCY,
  });
  worker.on("failed", (job, error) => {
    logger.error(
      { err: error, jobId: job?.id, data: job?.data },
      "Syllabus ingest job failed",
    );
  });
  worker.on("completed", (job) => {
    logger.info(
      { jobId: job.id, data: job.data },
      "Syllabus ingest job completed",
    );
  });
  logger.info(
    { concurrency: env.SYLLABUS_INGEST_WORKER_CONCURRENCY },
    "Syllabus ingest worker started",
  );
  return worker;
}

export async function enqueueSyllabusReindex(syllabusId: string) {
  return replaceOrSkipJob(
    `syllabus-reindex-${syllabusId}`,
    "reindex-syllabus",
    { type: "reindex-syllabus", syllabusId },
  );
}

export async function enqueueSyllabusDocumentIndex(documentId: string) {
  return replaceOrSkipJob(
    `syllabus-doc-${documentId}`,
    "index-document",
    { type: "index-document", documentId },
  );
}
