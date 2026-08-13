import { authenticator } from "otplib";

const APP_NAME = "Enhance Education";

authenticator.options = {
  window: 1,
};

export function generateAuthenticatorSecret(): string {
  return authenticator.generateSecret();
}

export function buildAuthenticatorUri(email: string, secret: string): string {
  return authenticator.keyuri(email, APP_NAME, secret);
}

export function verifyAuthenticatorCode(
  code: string,
  secret: string,
): boolean {
  try {
    return authenticator.check(code, secret);
  } catch {
    return false;
  }
}
