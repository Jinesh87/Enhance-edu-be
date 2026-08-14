import { Redis } from "ioredis";
import { logger } from "./logger.js";
import { env } from "./env.js";

const redisUrl = env.REDIS_URL;

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

export const redisSubscriber = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

redis.on("error", (error: Error) => {
  logger.error({ err: error }, "Redis main client error");
});

redisSubscriber.on("error", (error: Error) => {
  logger.error({ err: error }, "Redis subscriber client error");
});

export async function connectRedis(): Promise<void> {
  const promises: Promise<void>[] = [];

  if (redis.status !== "ready" && redis.status !== "connecting") {
    promises.push(
      redis.connect().then(() => {
        logger.info("Redis main client connected");
      }),
    );
  }

  if (
    redisSubscriber.status !== "ready" &&
    redisSubscriber.status !== "connecting"
  ) {
    promises.push(
      redisSubscriber.connect().then(() => {
        logger.info("Redis subscriber client connected");
      }),
    );
  }

  await Promise.all(promises);
}
