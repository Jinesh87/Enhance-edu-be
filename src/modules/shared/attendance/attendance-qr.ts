import crypto from "crypto";
import { env } from "../../../config/env.js";

const QR_SECRET = env.QR_SECRET;

export const QR_ROTATION_WINDOW_MS = env.QR_ROTATION_WINDOW_MS;

function createSignature(sessionId: string, windowIndex: number) {
  return crypto
    .createHmac("sha256", QR_SECRET)
    .update(`${sessionId}:${windowIndex}`)
    .digest("hex");
}

export function generateAttendanceQr(sessionId: string) {
  const now = Date.now();

  const windowIndex = Math.floor(now / QR_ROTATION_WINDOW_MS);

  const signature = createSignature(sessionId, windowIndex);

  const expiresInSeconds = Math.ceil(
    ((windowIndex + 1) * QR_ROTATION_WINDOW_MS - now) / 1000,
  );

  return {
    code: `${sessionId}:${windowIndex}:${signature}`,
    expiresInSeconds,
  };
}

export function validateAttendanceQr(
  scannedCode: string,
  sessionId: string,
  scannedAt: Date,
) {
  const parts = scannedCode.split(":");

  if (parts.length !== 3) {
    return {
      valid: false,
      reason: "TOKEN_EXPIRED",
    };
  }

  const [codeSessionId, windowValue, receivedSignature] = parts;

  if (codeSessionId !== sessionId) {
    return {
      valid: false,
      reason: "WRONG_SESSION_CODE",
    };
  }

  const codeWindowIndex = Number(windowValue);

  if (!Number.isInteger(codeWindowIndex)) {
    return {
      valid: false,
      reason: "TOKEN_EXPIRED",
    };
  }

  const expectedSignature = createSignature(codeSessionId, codeWindowIndex);

  const receivedBuffer = Buffer.from(receivedSignature, "hex");

  const expectedBuffer = Buffer.from(expectedSignature, "hex");

  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    return {
      valid: false,
      reason: "TOKEN_EXPIRED",
    };
  }

  const currentWindow = Math.floor(scannedAt.getTime() / QR_ROTATION_WINDOW_MS);

  const tolerance = 10;
  const isRecent =
    codeWindowIndex >= currentWindow - tolerance &&
    codeWindowIndex <= currentWindow + tolerance;

  if (!isRecent) {
    return {
      valid: false,
      reason: "TOKEN_EXPIRED",
    };
  }

  return {
    valid: true,
    reason: null,
  };
}
