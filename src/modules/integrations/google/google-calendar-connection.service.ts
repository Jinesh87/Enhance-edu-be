import jwt from "jsonwebtoken";
import { AppDataSource } from "../../../config/data-source.js";
import { env } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";
import { AppError } from "../../../common/errors/AppError.js";
import { decryptSecret, encryptSecret } from "../../../common/utils/secret-box.js";
import { GoogleCalendarConnection } from "../../../entities/GoogleCalendarConnection.js";
import {
  GOOGLE_CALENDAR_SCOPES,
  googleCalendarConfigService,
} from "./google-calendar-config.service.js";

const STATE_TTL = "10m";
const STATE_TYPE = "google_calendar_oauth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
/** Refresh access tokens this long before Google's stated expiry. */
const EXPIRY_SKEW_MS = 60_000;

const RETURN_PATH_PREFIXES = ["/tutor", "/guardian", "/admin"];

type OAuthState = { sub: string; returnTo: string; type: typeof STATE_TYPE };

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

export type GoogleCalendarConnectionStatus = {
  available: boolean;
  connected: boolean;
  googleEmail: string | null;
  connectedAt: string | null;
};

function stateSecret() {
  const secret = env.JWT_ACCESS_SECRET;
  if (!secret) throw new AppError(500, "JWT_ACCESS_SECRET is not configured", "CONFIG_ERROR");
  return secret;
}

function safeReturnPath(raw: string | undefined | null) {
  const path = (raw ?? "").trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/";
  return RETURN_PATH_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`)) ? path : "/";
}

function emailFromIdToken(idToken: string | undefined) {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as {
      email?: string;
    };
    return payload.email ?? null;
  } catch {
    return null;
  }
}

function repo() {
  return AppDataSource.getRepository(GoogleCalendarConnection);
}

async function postForm(url: string, params: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  return (await response.json().catch(() => ({}))) as TokenResponse;
}

async function requireCredentials() {
  const credentials = await googleCalendarConfigService.getCredentials();
  if (!credentials) {
    throw new AppError(
      409,
      "Google Calendar isn't set up for this institution yet. Ask your administrator.",
      "GOOGLE_CALENDAR_UNAVAILABLE",
    );
  }
  return credentials;
}

class GoogleCalendarConnectionService {
  async status(userId: string): Promise<GoogleCalendarConnectionStatus> {
    const [credentials, connection] = await Promise.all([
      googleCalendarConfigService.getCredentials(),
      repo().findOne({ where: { userId } }),
    ]);
    return {
      available: Boolean(credentials),
      connected: Boolean(connection),
      googleEmail: connection?.googleEmail ?? null,
      connectedAt: connection?.connectedAt.toISOString() ?? null,
    };
  }

  async createAuthUrl(userId: string, returnTo?: string | null) {
    const { clientId, redirectUri } = await requireCredentials();
    const state = jwt.sign(
      { sub: userId, returnTo: safeReturnPath(returnTo), type: STATE_TYPE },
      stateSecret(),
      { expiresIn: STATE_TTL },
    );
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GOOGLE_CALENDAR_SCOPES.join(" "),
      access_type: "offline",
      include_granted_scopes: "true",
      prompt: "select_account consent",
      state,
    });
    return { url: `${AUTH_URL}?${params.toString()}` };
  }

  /** Reads the state without trusting it for anything but the redirect target. */
  returnPathFromState(state: string | undefined) {
    if (!state) return "/";
    const decoded = jwt.decode(state) as Partial<OAuthState> | null;
    return safeReturnPath(decoded?.returnTo);
  }

  async handleCallback(code: string, state: string) {
    let payload: OAuthState;
    try {
      payload = jwt.verify(state, stateSecret()) as OAuthState;
    } catch {
      throw new AppError(400, "This connection link has expired. Try connecting again.", "GOOGLE_STATE_INVALID");
    }
    if (payload.type !== STATE_TYPE || !payload.sub) {
      throw new AppError(400, "Invalid connection request.", "GOOGLE_STATE_INVALID");
    }

    const { clientId, clientSecret, redirectUri } = await requireCredentials();
    const tokens = await postForm(TOKEN_URL, {
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    });
    if (!tokens.access_token) {
      logger.warn({ error: tokens.error, description: tokens.error_description }, "Google token exchange failed");
      throw new AppError(502, "Google didn't accept the sign-in. Please try again.", "GOOGLE_TOKEN_EXCHANGE_FAILED");
    }

    const grantedScopes = (tokens.scope ?? "").split(" ");
    if (!grantedScopes.includes("https://www.googleapis.com/auth/calendar.events")) {
      throw new AppError(
        400,
        "Calendar access wasn't granted. Tick the calendar permission when connecting.",
        "GOOGLE_SCOPE_MISSING",
      );
    }

    const existing = await repo().findOne({ where: { userId: payload.sub } });
    const refreshToken = tokens.refresh_token ?? decryptSecret(existing?.refreshTokenEnc);
    if (!refreshToken) {
      throw new AppError(
        400,
        "Google didn't return offline access. Remove Enhance from your Google Account permissions and connect again.",
        "GOOGLE_REFRESH_TOKEN_MISSING",
      );
    }

    const connection = existing ?? repo().create({ userId: payload.sub });
    connection.googleEmail = emailFromIdToken(tokens.id_token) ?? connection.googleEmail ?? null;
    connection.calendarId = "primary";
    connection.refreshTokenEnc = encryptSecret(refreshToken);
    connection.accessTokenEnc = encryptSecret(tokens.access_token);
    connection.accessTokenExpiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000);
    connection.scopes = tokens.scope ?? null;
    await repo().save(connection);

    return { returnTo: safeReturnPath(payload.returnTo) };
  }

  async disconnect(userId: string) {
    const connection = await repo().findOne({ where: { userId } });
    if (!connection) return;
    const token = decryptSecret(connection.refreshTokenEnc);
    if (token) {
      await postForm(REVOKE_URL, { token }).catch((error) => {
        logger.warn({ err: error }, "Google token revoke failed");
      });
    }
    await repo().delete({ id: connection.id });
  }

  /** A valid access token for the user's calendar, or null if they haven't connected (or access was revoked). */
  async getAccessToken(userId: string): Promise<{ accessToken: string; calendarId: string } | null> {
    const connection = await repo().findOne({ where: { userId } });
    if (!connection) return null;

    const cached = decryptSecret(connection.accessTokenEnc);
    if (
      cached &&
      connection.accessTokenExpiresAt &&
      connection.accessTokenExpiresAt.getTime() - EXPIRY_SKEW_MS > Date.now()
    ) {
      return { accessToken: cached, calendarId: connection.calendarId };
    }

    const credentials = await googleCalendarConfigService.getCredentials();
    const refreshToken = decryptSecret(connection.refreshTokenEnc);
    if (!credentials || !refreshToken) return null;

    const tokens = await postForm(TOKEN_URL, {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    });
    if (!tokens.access_token) {
      if (tokens.error === "invalid_grant") {
        await repo().delete({ id: connection.id });
      }
      logger.warn({ userId, error: tokens.error }, "Google token refresh failed");
      return null;
    }

    connection.accessTokenEnc = encryptSecret(tokens.access_token);
    connection.accessTokenExpiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000);
    await repo().save(connection);
    return { accessToken: tokens.access_token, calendarId: connection.calendarId };
  }
}

export const googleCalendarConnectionService = new GoogleCalendarConnectionService();
