import { randomInt } from "node:crypto";
import { redis } from "../../config/redis.js";
import { logger } from "../../config/logger.js";
import { env } from "../../config/env.js";

const CODE_PREFIX = "invitation-2fa:";
const CODE_TTL_SECONDS = 10 * 60; // 10 minutes

export function generateSecurityCode(): string {
  return randomInt(100_000, 1_000_000).toString();
}

export async function storeInvitation2faCode(
  setupId: string,
  code: string,
): Promise<void> {
  const key = `${CODE_PREFIX}${setupId}`;
  await redis.setex(key, CODE_TTL_SECONDS, code);

  if (env.NODE_ENV !== "production") {
    logger.debug({ setupId, code }, "2FA code generated (dev only)");
  }
}

export async function verifyInvitation2faCode(
  setupId: string,
  code: string,
): Promise<boolean> {
  const key = `${CODE_PREFIX}${setupId}`;
  const stored = await redis.get(key);

  if (!stored || stored !== code.trim()) {
    return false;
  }

  await redis.del(key);
  return true;
}

export async function deleteInvitation2faCode(setupId: string): Promise<void> {
  const key = `${CODE_PREFIX}${setupId}`;
  await redis.del(key);
}
