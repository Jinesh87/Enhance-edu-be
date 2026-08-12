import bcrypt from "bcrypt";

const ROUNDS = 12;

export async function hashValue(value: string): Promise<string> {
  return bcrypt.hash(value, ROUNDS);
}

export async function verifyHash(
  value: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(value, hash);
}
