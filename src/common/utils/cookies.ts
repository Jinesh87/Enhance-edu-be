import type { CookieOptions, Response } from "express";
import { env } from "../../config/env.js";

const ACCESS_COOKIE = "access_token";
const REFRESH_COOKIE = "refresh_token";

function baseCookieOptions(): CookieOptions {
  const isProduction = env.NODE_ENV === "production";

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/",
  };
}

export function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
) {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...baseCookieOptions(),
    maxAge: parseDurationMs(env.JWT_ACCESS_EXPIRES_IN),
  });

  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...baseCookieOptions(),
    maxAge: parseDurationMs(env.JWT_REFRESH_EXPIRES_IN),
  });
}

export function clearAuthCookies(res: Response) {
  const options = baseCookieOptions();
  res.clearCookie(ACCESS_COOKIE, options);
  res.clearCookie(REFRESH_COOKIE, options);
}

export function getAccessTokenFromCookies(
  cookies: Record<string, string | undefined> | undefined,
): string | undefined {
  return cookies?.[ACCESS_COOKIE];
}

export function getRefreshTokenFromCookies(
  cookies: Record<string, string | undefined> | undefined,
): string | undefined {
  return cookies?.[REFRESH_COOKIE];
}

function parseDurationMs(raw: string): number {
  const match = /^(\d+)([smhd])$/.exec(raw);
  if (!match) {
    return 15 * 60 * 1000;
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return amount * multipliers[unit];
}
