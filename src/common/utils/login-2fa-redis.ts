import { randomBytes } from "node:crypto";
import { redis } from "../../config/redis.js";
import { logger } from "../../config/logger.js";
import { env } from "../../config/env.js";
import type { TwoFactorMethod } from "../constants/roles.js";
import { generateSecurityCode } from "./two-factor-redis.js";

const CHALLENGE_PREFIX = "login-2fa:";
const CODE_PREFIX = "login-2fa-code:";
const TTL_SECONDS = 10 * 60; // 10 minutes

export type Login2faChallenge = {
  userId: string;
  email: string;
  method: TwoFactorMethod;
};

export function generateLoginChallengeId(): string {
  return randomBytes(32).toString("base64url");
}

export async function storeLogin2faChallenge(
  challengeId: string,
  data: Login2faChallenge,
): Promise<void> {
  await redis.setex(
    `${CHALLENGE_PREFIX}${challengeId}`,
    TTL_SECONDS,
    JSON.stringify(data),
  );
}

export async function getLogin2faChallenge(
  challengeId: string,
): Promise<Login2faChallenge | null> {
  const raw = await redis.get(`${CHALLENGE_PREFIX}${challengeId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Login2faChallenge;
  } catch {
    return null;
  }
}

export async function deleteLogin2faChallenge(challengeId: string): Promise<void> {
  await redis.del(`${CHALLENGE_PREFIX}${challengeId}`);
  await redis.del(`${CODE_PREFIX}${challengeId}`);
}

export async function storeLogin2faCode(
  challengeId: string,
  code: string,
): Promise<void> {
  await redis.setex(`${CODE_PREFIX}${challengeId}`, TTL_SECONDS, code);
  if (env.NODE_ENV !== "production") {
    logger.debug({ challengeId, code }, "Login 2FA code generated (dev only)");
  }
}

export async function issueLogin2faCode(challengeId: string): Promise<string> {
  const code = generateSecurityCode();
  await storeLogin2faCode(challengeId, code);
  return code;
}

export async function verifyLogin2faCode(
  challengeId: string,
  code: string,
): Promise<boolean> {
  const key = `${CODE_PREFIX}${challengeId}`;
  const stored = await redis.get(key);
  if (!stored || stored !== code.trim()) {
    return false;
  }
  await redis.del(key);
  return true;
}
