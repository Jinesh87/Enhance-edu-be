import { randomBytes } from "node:crypto";
import { redis } from "../../config/redis.js";
import { logger } from "../../config/logger.js";
import { AppError } from "../errors/AppError.js";

const INVITATION_TTL_SECONDS = 48 * 60 * 60; // 48 hours
const INVITATION_PREFIX = "invitation:";

export interface InvitationData {
  userId: string;
  email: string;
  fullName: string;
}

/**
 * Generate a cryptographically secure invitation token
 */
export function generateInvitationToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Store invitation token in Redis with user data
 * Token can only be used once and expires after 48 hours
 */
export async function storeInvitationToken(
  token: string,
  data: InvitationData,
): Promise<void> {
  const key = `${INVITATION_PREFIX}${token}`;
  
  await redis.setex(
    key,
    INVITATION_TTL_SECONDS,
    JSON.stringify(data),
  );

  logger.info(
    { userId: data.userId, email: data.email },
    "Invitation token stored in Redis",
  );
}

/**
 * Verify and consume invitation token (one-time use)
 * Returns user data if valid, throws error otherwise
 */
export async function verifyAndConsumeInvitationToken(
  token: string,
): Promise<InvitationData> {
  const key = `${INVITATION_PREFIX}${token}`;
  
  // Get token data
  const data = await redis.get(key);
  
  if (!data) {
    throw new AppError(
      400,
      "Invitation link is invalid or has expired",
      "INVALID_INVITATION",
    );
  }

  // Delete immediately to make it one-time use
  await redis.del(key);

  try {
    const invitationData = JSON.parse(data) as InvitationData;
    
    logger.info(
      { userId: invitationData.userId, email: invitationData.email },
      "Invitation token consumed",
    );

    return invitationData;
  } catch (error) {
    logger.error({ error }, "Failed to parse invitation data from Redis");
    throw new AppError(
      500,
      "Invalid invitation data format",
      "INVALID_INVITATION_DATA",
    );
  }
}

/**
 * Read invitation token data without consuming it
 */
export async function getInvitationTokenData(
  token: string,
): Promise<InvitationData | null> {
  const key = `${INVITATION_PREFIX}${token}`;
  const data = await redis.get(key);

  if (!data) {
    return null;
  }

  try {
    return JSON.parse(data) as InvitationData;
  } catch (error) {
    logger.error({ error }, "Failed to parse invitation data from Redis");
    return null;
  }
}

/**
 * Check if invitation token exists without consuming it
 */
export async function checkInvitationTokenExists(
  token: string,
): Promise<boolean> {
  const key = `${INVITATION_PREFIX}${token}`;
  const exists = await redis.exists(key);
  return exists === 1;
}

/**
 * Delete invitation token (e.g., when resending or canceling)
 */
export async function deleteInvitationToken(token: string): Promise<void> {
  const key = `${INVITATION_PREFIX}${token}`;
  await redis.del(key);
}

/**
 * Delete all invitation tokens for a user (e.g., when resending)
 */
export async function deleteUserInvitationTokens(
  userId: string,
): Promise<void> {
  // Scan for all invitation keys
  let cursor = "0";
  let deletedCount = 0;

  do {
    const [newCursor, keys] = await redis.scan(
      cursor,
      "MATCH",
      `${INVITATION_PREFIX}*`,
      "COUNT",
      "100",
    );
    cursor = newCursor;

    for (const key of keys) {
      const data = await redis.get(key);
      if (data) {
        try {
          const invData = JSON.parse(data) as InvitationData;
          if (invData.userId === userId) {
            await redis.del(key);
            deletedCount++;
          }
        } catch {
          // Skip invalid data
        }
      }
    }
  } while (cursor !== "0");

  if (deletedCount > 0) {
    logger.info(
      { userId, deletedCount },
      "Deleted previous invitation tokens for user",
    );
  }
}
