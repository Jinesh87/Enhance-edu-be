import { openAiUsageService } from "../../../../common/ai/openai-usage.service.js";
import { settingsService } from "../../../settings/settings.service.js";
import { AppError } from "../../../../common/errors/AppError.js";
import { UserRole } from "../../../../common/constants/roles.js";
import {
  assertAdminAiModule,
  type AdminAiActor,
} from "../authorization.js";
import { sanitizeToolPayload } from "../sanitize.js";
import { openPageAction, type ToolResult } from "../tool-helpers.js";

/** Non-secret institution flags only. */
export async function getInstitutionSettingsSummary(
  actor: AdminAiActor,
): Promise<ToolResult> {
  assertAdminAiModule(actor, "settings");

  const security = await settingsService.getSecuritySettings();
  const openAi = await settingsService.getOpenAiSettings();
  const guardian = await settingsService.getGuardianPortalSettings();
  const notifications = await settingsService.getNotificationSettings();

  return {
    data: sanitizeToolPayload({
      entity: "settings",
      login2faEnabled: security.login2faEnabled,
      sandboxModeEnabled: security.sandboxModeEnabled,
      openAiConfigured: openAi.configured,
      sessionChangeEmailNotificationsEnabled:
        notifications.sessionChangeEmailNotificationsEnabled,
      guardianPortal: {
        classDetailsEnabled: guardian.classDetailsEnabled,
        assessmentsEnabled: guardian.assessmentsEnabled,
        entranceExamsEnabled: guardian.entranceExamsEnabled,
        attendanceEnabled: guardian.attendanceEnabled,
      },
      responseHint:
        "Summarise settings briefly in plain language. Never mention API keys or secrets.",
    }),
    sources: [
      {
        kind: "database",
        label: "Institution settings",
        detail: "Flags only",
      },
    ],
    actions: [openPageAction("institution-settings", "Open Institution Settings")],
  };
}

/** Super Admin only — OpenAI usage aggregates. */
export async function getAiUsageSummary(
  actor: AdminAiActor,
  args: { days?: number },
): Promise<ToolResult> {
  assertAdminAiModule(actor, "settings");
  if (actor.role !== UserRole.SUPER_ADMIN) {
    throw new AppError(
      403,
      "You do not have permission to access this information.",
      "ADMIN_AI_MODULE_FORBIDDEN",
    );
  }

  const days = Math.min(90, Math.max(1, Math.floor(args.days ?? 30)));
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - days);

  const summary = await openAiUsageService.getSummary({ from, to: new Date() });

  return {
    data: sanitizeToolPayload({
      entity: "ai_usage",
      days,
      requestCount: summary.requestCount,
      successCount: summary.successCount,
      errorCount: summary.errorCount,
      totalTokens: summary.totalTokens,
      estimatedCostUsd: summary.estimatedCostUsd,
      byFeature: summary.byFeature.slice(0, 12),
      byModel: summary.byModel.slice(0, 8),
      responseHint:
        "Short usage summary for Super Admin. Table by feature if useful: Feature | Requests | Tokens | Est. USD. No API keys.",
    }),
    sources: [
      {
        kind: "database",
        label: "OpenAI usage",
        detail: `Last ${days} days`,
      },
    ],
    actions: [
      openPageAction("ai-usage", "Open AI Usage"),
      openPageAction("ai-settings", "Open AI Settings"),
    ],
  };
}

export async function getDraftContext(
  actor: AdminAiActor,
  args: { topic?: string },
): Promise<ToolResult> {
  // Draft context is available to any Admin AI caller; no write side effects.
  void actor;
  return {
    data: sanitizeToolPayload({
      topic: args.topic?.trim() || "general notice",
      guidance:
        "Produce a clearly labeled Draft only. Do not send, publish, or claim delivery.",
      institutionTone: "Professional, clear, supportive tutoring-centre voice.",
    }),
    sources: [
      {
        kind: "draft",
        label: "Draft context",
        detail: args.topic?.trim() || "general",
      },
    ],
  };
}
