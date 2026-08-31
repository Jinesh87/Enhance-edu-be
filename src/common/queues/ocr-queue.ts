import { Queue, Worker, type Job } from "bullmq";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { AppDataSource } from "../../config/data-source.js";
import {
  AssessmentSubmission,
  AssessmentSubmissionFile,
} from "../../entities/index.js";
import { getObjectBuffer } from "../storage/object-storage.js";
import {
  extractTextWithAzureRead,
  isAzureDocumentIntelligenceConfigured,
} from "../ocr/azure-document-intelligence.js";

export type OcrJobPayload = {
  submissionId: string;
};

const QUEUE_NAME = "entrance-exam-ocr";

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () =>
      runWorker(),
    ),
  );
  return results;
}

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

async function runAzureOcr(submissionId: string): Promise<string> {
  if (!isAzureDocumentIntelligenceConfigured()) {
    throw new Error(
      "Azure Document Intelligence is not configured. Set AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY.",
    );
  }

  const fileRepo = AppDataSource.getRepository(AssessmentSubmissionFile);
  const files = await fileRepo.find({
    where: { submissionId },
    order: { sortOrder: "ASC" },
  });

  if (files.length === 0) {
    throw new Error("No submission files found for OCR");
  }

  const pageTexts = await mapWithConcurrency(
    files,
    env.OCR_FILE_CONCURRENCY,
    async (file) => {
      const buffer = await getObjectBuffer(file.storageKey);
      const pageText = await extractTextWithAzureRead(buffer);
      file.extractedText = pageText || null;
      return pageText;
    },
  );

  await fileRepo.save(files);

  return pageTexts.filter((text): text is string => Boolean(text)).join("\n\n---\n\n");
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
    const text = await runAzureOcr(submission.id);
    submission.extractedText = text || null;
    submission.status = "READY";
    await submissionRepo.save(submission);
    logger.info({ submissionId: submission.id }, "OCR job completed");
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
    concurrency: env.OCR_WORKER_CONCURRENCY,
  });
  worker.on("failed", (job, error) => {
    logger.error(
      { err: error, jobId: job?.id, submissionId: job?.data.submissionId },
      "OCR job failed",
    );
  });
  if (isAzureDocumentIntelligenceConfigured()) {
    logger.info("Entrance-exam OCR worker started (Azure Document Intelligence)");
  } else {
    logger.warn(
      "Entrance-exam OCR worker started, but Azure Document Intelligence env is missing — jobs will fail until configured",
    );
  }
  return worker;
}

export async function enqueueOcrJob(submissionId: string) {
  await getOcrQueue().add(
    "ocr",
    { submissionId },
    { jobId: `ocr-${submissionId}-${Date.now()}` },
  );
}
