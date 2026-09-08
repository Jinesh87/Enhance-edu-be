import { redis } from "../../../config/redis.js";
import { AppError } from "../../../common/errors/AppError.js";
import { env } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";

function minuteKey(userId: string) {
  const bucket = Math.floor(Date.now() / 60_000);
  return `admin-ai:rl:min:${userId}:${bucket}`;
}

function dayKey(userId: string) {
  const day = new Date().toISOString().slice(0, 10);
  return `admin-ai:rl:day:${userId}:${day}`;
}

export async function assertAdminAiRateLimit(userId: string) {
  try {
    const minKey = minuteKey(userId);
    const dKey = dayKey(userId);

    const minuteCount = await redis.incr(minKey);
    if (minuteCount === 1) {
      await redis.expire(minKey, 120);
    }

    const dayCount = await redis.incr(dKey);
    if (dayCount === 1) {
      await redis.expire(dKey, 60 * 60 * 48);
    }

    if (
      minuteCount > env.ADMIN_AI_RATE_LIMIT_PER_MIN ||
      dayCount > env.ADMIN_AI_RATE_LIMIT_PER_DAY
    ) {
      throw new AppError(
        429,
        "Too many Admin AI requests. Please try again later.",
        "ADMIN_AI_RATE_LIMITED",
      );
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    // Redis outage should not take Admin AI offline.
    logger.warn(
      { err: error, userId },
      "Admin AI rate limit check failed; allowing request",
    );
  }
}
