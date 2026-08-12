import { randomBytes } from "node:crypto";
import { redis } from "../../config/redis.js";
import type { TwoFactorMethod, UserRole } from "../constants/roles.js";

const SETUP_PREFIX = "invitation-setup:";
const SETUP_TTL_SECONDS = 2 * 60 * 60; // 2 hours

export interface InvitationSetupData {
  invitationToken: string;
  userId: string;
  email: string;
  fullName: string;
  role: UserRole;
  passwordHash: string;
  preferredName: string | null;
  mobile: string | null;
  twoFactorMethod?: TwoFactorMethod;
}

export function generateSetupId(): string {
  return randomBytes(32).toString("base64url");
}

export async function storeInvitationSetup(
  setupId: string,
  data: InvitationSetupData,
): Promise<void> {
  const key = `${SETUP_PREFIX}${setupId}`;
  await redis.setex(key, SETUP_TTL_SECONDS, JSON.stringify(data));
}

export async function getInvitationSetup(
  setupId: string,
): Promise<InvitationSetupData | null> {
  const key = `${SETUP_PREFIX}${setupId}`;
  const data = await redis.get(key);
  if (!data) return null;

  try {
    return JSON.parse(data) as InvitationSetupData;
  } catch {
    return null;
  }
}

export async function updateInvitationSetup(
  setupId: string,
  data: InvitationSetupData,
): Promise<void> {
  const key = `${SETUP_PREFIX}${setupId}`;
  const ttl = await redis.ttl(key);
  if (ttl <= 0) return;

  await redis.setex(key, ttl, JSON.stringify(data));
}

export async function deleteInvitationSetup(setupId: string): Promise<void> {
  const key = `${SETUP_PREFIX}${setupId}`;
  await redis.del(key);
}
