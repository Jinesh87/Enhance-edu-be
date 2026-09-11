import { AppError } from "../../../common/errors/AppError.js";
import { settingsService } from "../../settings/settings.service.js";

  export const ADMIN_AI_CAPABILITIES = [
  "assistant",
  "dataInsights",
  "emailDrafting",
  "messageDrafting",
  "bulkCommunication",
  "notificationSuggestions",
  "proactiveBriefing",
  "reportBuilder",
  "deepLinks",
  "confirmedActions",
] as const;

export type AdminAiCapability = (typeof ADMIN_AI_CAPABILITIES)[number];

export type AdminAiBriefingConfig = {
  time: string | null;
  daysOfWeek: number[];
  sections: string[];
};

export type AdminAiCapabilitySettings = {
  assistantEnabled: boolean;
  dataInsightsEnabled: boolean;
  emailDraftingEnabled: boolean;
  messageDraftingEnabled: boolean;
  bulkCommunicationEnabled: boolean;
  notificationSuggestionsEnabled: boolean;
  proactiveBriefingEnabled: boolean;
  reportBuilderEnabled: boolean;
  deepLinksEnabled: boolean;
  confirmedActionsEnabled: boolean;
  briefingConfig: AdminAiBriefingConfig;
};

export const DEFAULT_ADMIN_AI_BRIEFING_CONFIG: AdminAiBriefingConfig = {
  time: "08:00",
  daysOfWeek: [1, 2, 3, 4, 5],
  sections: ["attendance", "tasks", "enquiries"],
};

export const DEFAULT_ADMIN_AI_CAPABILITY_SETTINGS: AdminAiCapabilitySettings = {
  assistantEnabled: true,
  dataInsightsEnabled: true,
  emailDraftingEnabled: true,
  messageDraftingEnabled: true,
  bulkCommunicationEnabled: true,
  notificationSuggestionsEnabled: true,
  proactiveBriefingEnabled: true,
  reportBuilderEnabled: true,
  deepLinksEnabled: true,
  confirmedActionsEnabled: true,
  briefingConfig: DEFAULT_ADMIN_AI_BRIEFING_CONFIG,
};

const DISABLED_MESSAGES: Record<AdminAiCapability, string> = {
  assistant:
    "Admin AI Assistant is disabled. You can enable it in Settings → AI.",
  dataInsights:
    "AI Data Insights is disabled. You can enable it in Settings → AI.",
  emailDrafting:
    "AI Email Drafting is disabled. You can enable it in Settings → AI.",
  messageDrafting:
    "AI Message Drafting is disabled. You can enable it in Settings → AI.",
  bulkCommunication:
    "Bulk Communication is disabled. You can enable it in Settings → AI.",
  notificationSuggestions:
    "AI Notification Suggestions are disabled. You can enable them in Settings → AI.",
  proactiveBriefing:
    "Proactive Briefings are disabled. You can enable them in Settings → AI.",
  reportBuilder:
    "Report Builder is currently disabled. You can enable it in Settings → AI.",
  deepLinks:
    "AI Deep Links are disabled. You can enable them in Settings → AI.",
  confirmedActions:
    "Confirmed AI Actions are disabled. You can enable them in Settings → AI.",
};

export function disabledCapabilityMessage(capability: AdminAiCapability): string {
  return DISABLED_MESSAGES[capability];
}

export function isCapabilityDisabledReply(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  for (const message of Object.values(DISABLED_MESSAGES)) {
    if (t === message || t.includes(message)) return true;
  }
  return (
    /\bis disabled\b/i.test(t) &&
    /settings\s*(→|->|–|-)?\s*ai\b/i.test(t)
  );
}

export function isCapabilityEnabled(
  settings: AdminAiCapabilitySettings,
  capability: AdminAiCapability,
): boolean {
  switch (capability) {
    case "assistant":
      return settings.assistantEnabled;
    case "dataInsights":
      return settings.dataInsightsEnabled;
    case "emailDrafting":
      return settings.emailDraftingEnabled;
    case "messageDrafting":
      return settings.messageDraftingEnabled;
    case "bulkCommunication":
      return settings.bulkCommunicationEnabled;
    case "notificationSuggestions":
      return settings.notificationSuggestionsEnabled;
    case "proactiveBriefing":
      return settings.proactiveBriefingEnabled;
    case "reportBuilder":
      return settings.reportBuilderEnabled;
    case "deepLinks":
      return settings.deepLinksEnabled;
    case "confirmedActions":
      return settings.confirmedActionsEnabled;
    default:
      return true;
  }
}

const TOOL_CAPABILITY: Record<string, AdminAiCapability | null> = {
  previewReport: "reportBuilder",
  updateReportPreview: "reportBuilder",
  generateReport: "reportBuilder",
  createCommunicationDraft: "emailDrafting",
  updateCommunicationDraft: "emailDrafting",
  previewAudience: "emailDrafting",
  getCommunicationDraft: "emailDrafting",
  getOpsSnapshot: "dataInsights",
  getAcademicPerformanceSummary: "dataInsights",
  getAttendanceSummary: "dataInsights",
  getEnquiryPipelineSummary: "dataInsights",
  getPendingEnrollmentSummary: "dataInsights",
  getOpenTasksSummary: "dataInsights",
  getPendingHomeworkSummary: "dataInsights",
};

export function capabilityForTool(toolName: string): AdminAiCapability | null {
  return TOOL_CAPABILITY[toolName] ?? null;
}

export function assertCapabilityEnabled(
  settings: AdminAiCapabilitySettings,
  capability: AdminAiCapability,
): void {
  if (isCapabilityEnabled(settings, capability)) return;
  throw new AppError(
    403,
    disabledCapabilityMessage(capability),
    "ADMIN_AI_CAPABILITY_DISABLED",
  );
}

export function isBulkRecipientAudience(recipientCount: number): boolean {
  return recipientCount > 1;
}

export function assertBulkCommunicationIfNeeded(
  settings: AdminAiCapabilitySettings,
  recipientCount: number,
): void {
  if (!isBulkRecipientAudience(recipientCount)) return;
  assertCapabilityEnabled(settings, "bulkCommunication");
}

export async function loadAdminAiCapabilitySettings(): Promise<AdminAiCapabilitySettings> {
  return settingsService.getAdminAiCapabilitySettings();
}

export function formatDisabledCapabilitiesForPrompt(
  settings: AdminAiCapabilitySettings,
): string {
  const disabled: string[] = [];
  for (const key of ADMIN_AI_CAPABILITIES) {
    if (key === "assistant") continue;
    if (!isCapabilityEnabled(settings, key)) {
      disabled.push(`- ${disabledCapabilityMessage(key)}`);
    }
  }
  if (!disabled.length) return "";
  return [
    "Admin AI capability restrictions (institution Settings → AI):",
    "If the user asks for a disabled capability, reply with ONLY the matching short disabled message below. Do not call tools for that capability. Do not invent technical errors.",
    ...disabled,
  ].join("\n");
}

const BRIEFING_INTENT =
  /\b(briefing|morning\s+brief|daily\s+brief|proactive\s+brief)\b/i;
const NOTIFICATION_SUGGEST_INTENT =
  /\b(notification\s+suggest|suggest\s+notification|notify\s+suggestion)\b/i;

export function precheckCapabilityIntent(
  content: string,
  settings: AdminAiCapabilitySettings,
): string | null {
  if (
    BRIEFING_INTENT.test(content) &&
    !isCapabilityEnabled(settings, "proactiveBriefing")
  ) {
    return disabledCapabilityMessage("proactiveBriefing");
  }
  if (
    NOTIFICATION_SUGGEST_INTENT.test(content) &&
    !isCapabilityEnabled(settings, "notificationSuggestions")
  ) {
    return disabledCapabilityMessage("notificationSuggestions");
  }
  return null;
}
