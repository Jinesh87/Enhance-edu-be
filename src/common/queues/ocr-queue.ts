import { Queue, Worker, type Job } from "bullmq";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { AppDataSource } from "../../config/data-source.js";
import {
  AssessmentSubmission,
  AssessmentSubmissionFile,
} from "../../entities/index.js";
import { getObjectBuffer } from "../storage/object-storage.js";

export type OcrJobPayload = {
  submissionId: string;
};

const QUEUE_NAME = "entrance-exam-ocr";

function redisConnection() {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    maxRetriesPerRequest: null as null,
  };
}

let queue: Queue<OcrJobPayload> | null = null;
let worker: Worker<OcrJobPayload> | null = null;

export function getOcrQueue(): Queue<OcrJobPayload> {
  if (!queue) {
    queue = new Queue<OcrJobPayload>(QUEUE_NAME, {
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

/**
 * Stub OCR: stores a readable placeholder from file metadata.
 * Swap getObjectBuffer + this function for a real handwriting model later.
 */
async function runStubOcr(submissionId: string): Promise<string> {
  const fileRepo = AppDataSource.getRepository(AssessmentSubmissionFile);
  const files = await fileRepo.find({
    where: { submissionId },
    order: { sortOrder: "ASC" },
  });

  const parts: string[] = [];
  for (const file of files) {
    // Touch storage so misconfigured buckets fail the job.
    await getObjectBuffer(file.storageKey);
    const pageText =
      `[OCR pending — handwriting conversion stub]\n` +
      `File: ${file.originalName} (${file.mimeType}, ${file.byteSize} bytes)\n` +
      `Replace this worker with a real OCR/HTR provider.`;
    file.extractedText = pageText;
    await fileRepo.save(file);
    parts.push(pageText);
  }
  return parts.join("\n\n---\n\n");
}

async function processJob(job: Job<OcrJobPayload>) {
  const submissionRepo = AppDataSource.getRepository(AssessmentSubmission);
  const submission = await submissionRepo.findOne({
    where: { id: job.data.submissionId },
  });
  if (!submission) {
    logger.warn({ submissionId: job.data.submissionId }, "OCR job: submission missing");
    return;
  }

  submission.status = "PROCESSING";
  submission.ocrError = null;
  await submissionRepo.save(submission);

  try {
    const text = await runStubOcr(submission.id);
    submission.extractedText = text;
    submission.status = "READY";
    await submissionRepo.save(submission);
    logger.info({ submissionId: submission.id }, "OCR job completed (stub)");
  } catch (error) {
    submission.status = "FAILED";
    submission.ocrError =
      error instanceof Error ? error.message : "OCR failed";
    await submissionRepo.save(submission);
    throw error;
  }
}

export function startOcrWorker() {
  if (worker) return worker;
  worker = new Worker<OcrJobPayload>(QUEUE_NAME, processJob, {
    connection: redisConnection(),
    concurrency: 2,
  });
  worker.on("failed", (job, error) => {
    logger.error(
      { err: error, jobId: job?.id, submissionId: job?.data.submissionId },
      "OCR job failed",
    );
  });
  logger.info("Entrance-exam OCR worker started");
  return worker;
}

export async function enqueueOcrJob(submissionId: string) {
  await getOcrQueue().add(
    "ocr",
    { submissionId },
    { jobId: `ocr-${submissionId}-${Date.now()}` },
  );
}
