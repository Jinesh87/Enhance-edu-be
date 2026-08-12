import { hashValue, verifyHash } from "./hash.js";

export async function hashPassword(password: string): Promise<string> {
  return hashValue(password);
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return verifyHash(password, passwordHash);
}
