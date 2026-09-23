import { Queue, Worker } from "bullmq";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { classRemindersService } from "../../modules/notifications/class-reminders.service.js";
import { homeworkRemindersService } from "../../modules/notifications/homework-reminders.service.js";
import { holidayRemindersService } from "../../modules/notifications/holiday-reminders.service.js";

const QUEUE_NAME = "class-reminders";
const TICK_JOB_NAME = "tick";

type ClassReminderTickPayload = {
  reason?: string;
};

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

let queue: Queue<ClassReminderTickPayload> | null = null;
let worker: Worker<ClassReminderTickPayload> | null = null;

export function getClassRemindersQueue(): Queue<ClassReminderTickPayload> {
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

async function processTick() {
  const [oneHour, digest, hwDue, hwOverdue, holidays] = await Promise.all([
    classRemindersService.run1hScan(),
    classRemindersService.runDigestScan(),
    homeworkRemindersService.runDueSoonScan(),
    homeworkRemindersService.runOverdueScan(),
    holidayRemindersService.runUpcomingScan(),
  ]);

  if (
    oneHour.sent > 0 ||
    digest.emailed > 0 ||
    hwDue.sent > 0 ||
    hwOverdue.sent > 0 ||
    holidays.sent > 0
  ) {
    logger.info(
      {
        oneHourScanned: oneHour.scanned,
        oneHourSent: oneHour.sent,
        digestClaimed: digest.claimed,
        digestEmailed: digest.emailed,
        homeworkDueScanned: hwDue.scanned,
        homeworkDueSent: hwDue.sent,
        homeworkOverdueScanned: hwOverdue.scanned,
        homeworkOverdueSent: hwOverdue.sent,
        holidayScanned: holidays.scanned,
        holidaySent: holidays.sent,
      },
      "Class reminders tick completed",
    );
  }
}

export function startClassRemindersWorker() {
  if (worker) return worker;

  const q = getClassRemindersQueue();

  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      if (job.name === TICK_JOB_NAME) {
        await processTick();
      }
    },
    {
      connection: redisConnection(),
      concurrency: 1,
    },
  );

  worker.on("failed", (job, err) => {
    logger.warn(
      { err, jobId: job?.id, name: job?.name },
      "Class reminders job failed",
    );
  });

  void q
    .upsertJobScheduler(
      "class-reminders-scheduler",
      { every: 5 * 60 * 1000 },
      {
        name: TICK_JOB_NAME,
        data: { reason: "repeatable" },
        opts: {
          removeOnComplete: true,
          removeOnFail: 50,
        },
      },
    )
    .then(() => {
      logger.info("Class reminders scheduler registered (every 5m)");
    })
    .catch((error) => {
      logger.warn({ err: error }, "Failed to schedule class-reminders tick");
    });

  logger.info("Class reminders worker started");
  return worker;
}
