import { randomBytes } from "node:crypto";
import { INVITATION_TTL_HOURS } from "../constants/roles.js";
import { hashValue, verifyHash } from "./hash.js";

export function createInvitationToken(): string {
  return randomBytes(32).toString("hex");
}

export async function hashInvitationToken(token: string): Promise<string> {
  return hashValue(token);
}

export async function verifyInvitationToken(
  token: string,
  tokenHash: string,
): Promise<boolean> {
  return verifyHash(token, tokenHash);
}

export function getInvitationExpiry(from = new Date()): Date {
  return new Date(from.getTime() + INVITATION_TTL_HOURS * 60 * 60 * 1000);
}
