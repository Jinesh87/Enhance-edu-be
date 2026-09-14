import { Queue, Worker, type Job } from "bullmq";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { settingsService } from "../../modules/settings/settings.service.js";
import { loadAdminAiCapabilitySettings } from "../../modules/admin/ai/admin-ai-capabilities.js";
import { adminAiBriefingService } from "../../modules/admin/ai/briefings/briefing.service.js";
import { localBriefingDateForRun } from "../../modules/admin/ai/briefings/briefing-schedule.js";

export type BriefingJobPayload = {
  userId: string;
  briefingDate: string;
  sections: string[];
  timeZone: string;
};

const QUEUE_NAME = "admin-ai-briefings";
const SCHEDULER_JOB_NAME = "check-due";
const GENERATE_JOB_NAME = "generate";

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

let queue: Queue | null = null;
let worker: Worker | null = null;
let schedulerWorker: Worker | null = null;

export function getBriefingsQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: redisConnection(),
      defaultJobOptions: {
        removeOnComplete: 200,
        removeOnFail: 300,
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
      },
    });
  }
  return queue;
}

async function enqueueGenerateJob(
  q: Queue,
  payload: BriefingJobPayload,
): Promise<void> {
  const jobId = `briefing:${payload.userId}:${payload.briefingDate}`;
  const existing = await q.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "completed" || state === "failed") {
      await existing.remove();
    } else if (
      state === "active" ||
      state === "waiting" ||
      state === "delayed" ||
      state === "prioritized" ||
      state === "waiting-children"
    ) {
      // Already queued for this user/date — keep the in-flight job.
      return;
    }
  }

  await q.add(GENERATE_JOB_NAME, payload, { jobId });
}

async function runSchedulerTick() {
  const settings = await loadAdminAiCapabilitySettings();
  if (!settings.proactiveBriefingEnabled) return;

  let config = await settingsService.ensureBriefingNextRunAt();
  if (!config.nextRunAt) return;

  const dueAt = new Date(config.nextRunAt);
  if (Number.isNaN(dueAt.getTime()) || dueAt.getTime() > Date.now()) return;

  const claim = await settingsService.claimBriefingSchedule(config.nextRunAt);
  if (!claim.claimed) return;

  config = claim.config;
  const briefingDate = localBriefingDateForRun(dueAt, config.timeZone);
  const userIds = await adminAiBriefingService.listEligibleAdminUserIds();
  const q = getBriefingsQueue();

  for (const userId of userIds) {
    const jobId = `briefing:${userId}:${briefingDate}`;
    try {
      await enqueueGenerateJob(q, {
        userId,
        briefingDate,
        sections: config.sections,
        timeZone: config.timeZone,
      });
    } catch (error) {
      logger.warn(
        { err: error, userId, briefingDate, jobId },
        "Failed to enqueue briefing job",
      );
    }
  }

  try {
    const purged = await adminAiBriefingService.purgeOlderThanRetention();
    if (purged > 0) {
      logger.info({ purged }, "Purged old Admin AI briefings");
    }
  } catch (error) {
    logger.warn({ err: error }, "Briefing retention purge failed");
  }

  logger.info(
    {
      briefingDate,
      userCount: userIds.length,
      nextRunAt: config.nextRunAt,
    },
    "Admin AI briefing schedule claimed",
  );
}

async function processGenerate(job: Job<BriefingJobPayload>) {
  const { userId, briefingDate, sections, timeZone } = job.data;
  await adminAiBriefingService.generateForUser({
    userId,
    briefingDate,
    sections: sections as never,
    timeZone,
    notify: true,
  });
}

export function startBriefingsWorker() {
  if (worker) return worker;

  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      if (job.name === SCHEDULER_JOB_NAME) {
        await runSchedulerTick();
        return;
      }
      if (job.name === GENERATE_JOB_NAME) {
        await processGenerate(job as Job<BriefingJobPayload>);
      }
    },
    {
      connection: redisConnection(),
      concurrency: Math.max(
        1,
        Number(process.env.ADMIN_AI_BRIEFING_CONCURRENCY ?? 3) || 3,
      ),
    },
  );

  worker.on("failed", (job, error) => {
    logger.error(
      { err: error, jobId: job?.id, name: job?.name, data: job?.data },
      "Admin AI briefing job failed",
    );
  });

  void getBriefingsQueue()
    .upsertJobScheduler(
      "admin-ai-briefing-scheduler",
      { every: 5 * 60 * 1000 },
      {
        name: SCHEDULER_JOB_NAME,
        data: {},
        opts: {
          removeOnComplete: true,
          removeOnFail: 50,
        },
      },
    )
    .then(() => {
      logger.info("Admin AI briefing scheduler registered (every 5m)");
    })
    .catch((error) => {
      logger.warn({ err: error }, "Failed to register briefing scheduler");
    });

  logger.info("Admin AI briefings worker started");
  return worker;
}

/** Alias kept for clarity in bootstrap. */
export function startBriefingsScheduler() {
  return startBriefingsWorker();
}

export { schedulerWorker };
