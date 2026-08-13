import { randomBytes } from "node:crypto";
import { redis } from "../../config/redis.js";
import { logger } from "../../config/logger.js";
import { AppError } from "../errors/AppError.js";

const RESET_TTL_SECONDS = 60 * 60; // 1 hour
const RESET_PREFIX = "password-reset:";

export interface PasswordResetData {
  userId: string;
  email: string;
}

export function generatePasswordResetToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function storePasswordResetToken(
  token: string,
  data: PasswordResetData,
): Promise<void> {
  const key = `${RESET_PREFIX}${token}`;
  await redis.setex(key, RESET_TTL_SECONDS, JSON.stringify(data));

  logger.info(
    { userId: data.userId, email: data.email },
    "Password reset token stored in Redis",
  );
}

export async function getPasswordResetTokenData(
  token: string,
): Promise<PasswordResetData | null> {
  const key = `${RESET_PREFIX}${token}`;
  const data = await redis.get(key);

  if (!data) {
    return null;
  }

  try {
    return JSON.parse(data) as PasswordResetData;
  } catch (error) {
    logger.error({ error }, "Failed to parse password reset data from Redis");
    return null;
  }
}

export async function verifyAndConsumePasswordResetToken(
  token: string,
): Promise<PasswordResetData> {
  const key = `${RESET_PREFIX}${token}`;
  const data = await redis.get(key);

  if (!data) {
    throw new AppError(
      400,
      "This reset link is invalid or has expired",
      "INVALID_RESET_TOKEN",
    );
  }

  await redis.del(key);

  try {
    const resetData = JSON.parse(data) as PasswordResetData;
    logger.info(
      { userId: resetData.userId, email: resetData.email },
      "Password reset token consumed",
    );
    return resetData;
  } catch (error) {
    logger.error({ error }, "Failed to parse password reset data from Redis");
    throw new AppError(
      500,
      "Invalid reset data format",
      "INVALID_RESET_DATA",
    );
  }
}

export async function deleteUserPasswordResetTokens(
  userId: string,
): Promise<void> {
  let cursor = "0";
  let deletedCount = 0;

  do {
    const [newCursor, keys] = await redis.scan(
      cursor,
      "MATCH",
      `${RESET_PREFIX}*`,
      "COUNT",
      "100",
    );
    cursor = newCursor;

    for (const key of keys) {
      const data = await redis.get(key);
      if (!data) continue;

      try {
        const resetData = JSON.parse(data) as PasswordResetData;
        if (resetData.userId === userId) {
          await redis.del(key);
          deletedCount++;
        }
      } catch {
        // Skip invalid data
      }
    }
  } while (cursor !== "0");

  if (deletedCount > 0) {
    logger.info(
      { userId, deletedCount },
      "Deleted previous password reset tokens for user",
    );
  }
}
