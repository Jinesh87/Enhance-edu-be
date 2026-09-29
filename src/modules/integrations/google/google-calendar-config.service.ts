import { env } from "../../../config/env.js";
import { AppError } from "../../../common/errors/AppError.js";
import { decryptSecret, encryptSecret } from "../../../common/utils/secret-box.js";
import { settingsService } from "../../settings/settings.service.js";

export const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];

export const GOOGLE_CALLBACK_PATH = "/api/integrations/google/callback";

export type GoogleCalendarConfig = {
  enabled: boolean;
  clientId: string | null;
  secretConfigured: boolean;
  secretHint: string | null;
  ready: boolean;
  verifiedAt: string | null;
  javascriptOrigin: string;
  redirectUri: string;
  scopes: string[];
};

export type UpdateGoogleCalendarConfigInput = {
  enabled: boolean;
  clientId: string | null;
  /** Omitted or empty keeps the stored secret. */
  clientSecret?: string | null;
  clearSecret?: boolean;
};

export function publicOrigin() {
  const raw = env.PUBLIC_APP_URL || env.FRONTEND_URL;
  try {
    return new URL(raw).origin;
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

function hint(secret: string | null) {
  if (!secret) return null;
  return `••••${secret.slice(-4)}`;
}

class GoogleCalendarConfigService {
  async getConfig(): Promise<GoogleCalendarConfig> {
    const setting = await settingsService.getDefaultSetting();
    const secret = decryptSecret(setting.googleClientSecretEnc);
    const clientId = setting.googleClientId?.trim() || null;
    const origin = publicOrigin();
    return {
      enabled: setting.googleCalendarEnabled,
      clientId,
      secretConfigured: Boolean(secret),
      secretHint: hint(secret),
      ready: setting.googleCalendarEnabled && Boolean(clientId && secret),
      verifiedAt: setting.googleCredentialsVerifiedAt?.toISOString() ?? null,
      javascriptOrigin: origin,
      redirectUri: `${origin}${GOOGLE_CALLBACK_PATH}`,
      scopes: GOOGLE_CALENDAR_SCOPES,
    };
  }

  async updateConfig(input: UpdateGoogleCalendarConfigInput): Promise<GoogleCalendarConfig> {
    const setting = await settingsService.getDefaultSetting();
    const nextClientId = input.clientId?.trim() || null;
    const nextSecret = input.clientSecret?.trim() || null;

    const credentialsChanged =
      nextClientId !== (setting.googleClientId?.trim() || null) ||
      Boolean(nextSecret) ||
      Boolean(input.clearSecret);

    setting.googleClientId = nextClientId;
    if (input.clearSecret) setting.googleClientSecretEnc = null;
    if (nextSecret) setting.googleClientSecretEnc = encryptSecret(nextSecret);
    if (credentialsChanged) setting.googleCredentialsVerifiedAt = null;

    const hasSecret = Boolean(decryptSecret(setting.googleClientSecretEnc));
    if (input.enabled && (!nextClientId || !hasSecret)) {
      throw new AppError(
        400,
        "Add the Client ID and Client secret before turning Google Calendar on",
        "GOOGLE_CREDENTIALS_REQUIRED",
      );
    }
    setting.googleCalendarEnabled = input.enabled;

    await settingsService.saveSetting(setting);
    return this.getConfig();
  }

  /** Stored credentials for the OAuth flow, or null when not set up / disabled. */
  async getCredentials(): Promise<{ clientId: string; clientSecret: string; redirectUri: string } | null> {
    const setting = await settingsService.getDefaultSetting();
    const clientId = setting.googleClientId?.trim();
    const clientSecret = decryptSecret(setting.googleClientSecretEnc);
    if (!setting.googleCalendarEnabled || !clientId || !clientSecret) return null;
    return { clientId, clientSecret, redirectUri: `${publicOrigin()}${GOOGLE_CALLBACK_PATH}` };
  }

  /**
   * Checks the client ID/secret against Google's token endpoint with a dummy code.
   * Google answers `invalid_client` for bad credentials and `invalid_grant` when the
   * credentials are fine (only the code is fake), so no user sign-in is needed.
   */
  async verify(): Promise<{ ok: boolean; message: string; config: GoogleCalendarConfig }> {
    const setting = await settingsService.getDefaultSetting();
    const clientId = setting.googleClientId?.trim();
    const clientSecret = decryptSecret(setting.googleClientSecretEnc);
    if (!clientId || !clientSecret) {
      throw new AppError(400, "Save a Client ID and Client secret first", "GOOGLE_CREDENTIALS_REQUIRED");
    }

    const origin = publicOrigin();
    let ok = false;
    let message: string;
    try {
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: "credential-check",
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: `${origin}${GOOGLE_CALLBACK_PATH}`,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        error_description?: string;
      };
      if (body.error === "invalid_grant") {
        ok = true;
        message = "Google accepted the Client ID and secret.";
      } else if (body.error === "invalid_client" || body.error === "unauthorized_client") {
        message = "Google rejected the Client ID or Client secret. Copy them again from the Google Cloud console.";
      } else if (body.error === "redirect_uri_mismatch") {
        message = `The redirect URI isn't registered on this OAuth client. Add ${origin}${GOOGLE_CALLBACK_PATH} under Authorized redirect URIs.`;
      } else {
        message = body.error_description || body.error || `Unexpected response from Google (HTTP ${response.status}).`;
      }
    } catch {
      message = "Couldn't reach Google from the server. Check the server's internet access and try again.";
    }

    setting.googleCredentialsVerifiedAt = ok ? new Date() : null;
    await settingsService.saveSetting(setting);
    return { ok, message, config: await this.getConfig() };
  }
}

export const googleCalendarConfigService = new GoogleCalendarConfigService();
