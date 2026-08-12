import { redis } from "../../../config/redis.js";
import type { LoginLockStatus } from "../types/auth.types.js";

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_SECONDS = 15 * 60;
const ATTEMPT_WINDOW_SECONDS = 15 * 60;

function attemptsKey(email: string): string {
  return `auth:login:attempts:${email}`;
}

function lockKey(email: string): string {
  return `auth:login:lock:${email}`;
}

export async function getLoginLockStatus(
  email: string,
): Promise<LoginLockStatus> {
  const ttlSeconds = await redis.ttl(lockKey(email));

  if (ttlSeconds > 0) {
    return {
      locked: true,
      lockedUntil: new Date(Date.now() + ttlSeconds * 1000),
    };
  }

  return { locked: false, lockedUntil: null };
}

export async function recordFailedLoginAttempt(
  email: string,
): Promise<LoginLockStatus> {
  const key = attemptsKey(email);
  const attempts = await redis.incr(key);

  if (attempts === 1) {
    await redis.expire(key, ATTEMPT_WINDOW_SECONDS);
  }

  if (attempts >= MAX_FAILED_ATTEMPTS) {
    await redis.set(lockKey(email), "1", "EX", LOCK_SECONDS);
    await redis.del(key);

    return {
      locked: true,
      lockedUntil: new Date(Date.now() + LOCK_SECONDS * 1000),
    };
  }

  return { locked: false, lockedUntil: null };
}

export async function clearLoginLockout(email: string): Promise<void> {
  await redis.del(attemptsKey(email), lockKey(email));
}
