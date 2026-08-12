import jwt from "jsonwebtoken";
import { UserRole } from "../constants/roles.js";
import { AppError } from "../errors/AppError.js";

export type AccessTokenPayload = {
  sub: string;
  email: string;
  role: UserRole;
  type: "access";
};

export type RefreshTokenPayload = {
  sub: string;
  tokenId: string;
  type: "refresh";
};

function requireSecret(name: string, value: string | undefined): string {
  if (!value) {
    throw new AppError(500, `${name} is not configured`, "CONFIG_ERROR");
  }
  return value;
}

export function signAccessToken(payload: Omit<AccessTokenPayload, "type">) {
  const secret = requireSecret("JWT_ACCESS_SECRET", process.env.JWT_ACCESS_SECRET);
  const expiresIn = process.env.JWT_ACCESS_EXPIRES_IN ?? "15m";

  return jwt.sign({ ...payload, type: "access" }, secret, { expiresIn } as jwt.SignOptions);
}

export function signRefreshToken(
  payload: Omit<RefreshTokenPayload, "type">,
) {
  const secret = requireSecret(
    "JWT_REFRESH_SECRET",
    process.env.JWT_REFRESH_SECRET,
  );
  const expiresIn = process.env.JWT_REFRESH_EXPIRES_IN ?? "7d";

  return jwt.sign({ ...payload, type: "refresh" }, secret, {
    expiresIn,
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const secret = requireSecret("JWT_ACCESS_SECRET", process.env.JWT_ACCESS_SECRET);
  const payload = jwt.verify(token, secret) as AccessTokenPayload;

  if (payload.type !== "access") {
    throw new AppError(401, "Invalid access token", "INVALID_TOKEN");
  }

  return payload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const secret = requireSecret(
    "JWT_REFRESH_SECRET",
    process.env.JWT_REFRESH_SECRET,
  );
  const payload = jwt.verify(token, secret) as RefreshTokenPayload;

  if (payload.type !== "refresh") {
    throw new AppError(401, "Invalid refresh token", "INVALID_TOKEN");
  }

  return payload;
}

export function getRefreshExpiresAt(): Date {
  const raw = process.env.JWT_REFRESH_EXPIRES_IN ?? "7d";
  const match = /^(\d+)([smhd])$/.exec(raw);

  if (!match) {
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return new Date(Date.now() + amount * multipliers[unit]);
}
