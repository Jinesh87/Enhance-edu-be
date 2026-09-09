import { redis } from "../../config/redis.js";
import { AppError } from "../../common/errors/AppError.js";
import { logger } from "../../config/logger.js";

const PER_MIN = 8;
const PER_DAY = 60;

function minuteKey(userId: string) {
  const bucket = Math.floor(Date.now() / 60_000);
  return `learning:rl:min:${userId}:${bucket}`;
}

function dayKey(userId: string) {
  const day = new Date().toISOString().slice(0, 10);
  return `learning:rl:day:${userId}:${day}`;
}

/** Prevent duplicate generate clicks for the same learning set. */
export async function acquireLearningGenerateLock(
  learningSetId: string,
): Promise<() => Promise<void>> {
  const key = `learning:gen:lock:${learningSetId}`;
  try {
    const ok = await redis.set(key, "1", "EX", 120, "NX");
    if (!ok) {
      throw new AppError(
        409,
        "Generation already in progress for this learning set.",
        "LEARNING_GENERATE_IN_PROGRESS",
      );
    }
    return async () => {
      try {
        await redis.del(key);
      } catch {
        /* ignore */
      }
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.warn(
      { err: error, learningSetId },
      "Learning generate lock failed; allowing request",
    );
    return async () => undefined;
  }
}

export async function assertLearningGenerateRateLimit(userId: string) {
  try {
    const minKey = minuteKey(userId);
    const dKey = dayKey(userId);

    const minuteCount = await redis.incr(minKey);
    if (minuteCount === 1) await redis.expire(minKey, 120);

    const dayCount = await redis.incr(dKey);
    if (dayCount === 1) await redis.expire(dKey, 60 * 60 * 48);

    if (minuteCount > PER_MIN || dayCount > PER_DAY) {
      throw new AppError(
        429,
        "Too many generation requests. Please try again later.",
        "LEARNING_RATE_LIMITED",
      );
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.warn(
      { err: error, userId },
      "Learning rate limit check failed; allowing request",
    );
  }
}
