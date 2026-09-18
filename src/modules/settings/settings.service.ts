import { AppDataSource } from "../../config/data-source.js";
import { InstitutionSetting } from "../../entities/index.js";
import {
  ADMIN_AI_BRIEFING_SECTIONS,
  DEFAULT_ADMIN_AI_BRIEFING_CONFIG,
  type AdminAiBriefingConfig,
  type AdminAiBriefingSection,
  type AdminAiCapabilitySettings,
} from "../admin/ai/admin-ai-capabilities.js";
import { computeNextBriefingRunAt } from "../admin/ai/briefings/briefing-schedule.js";
import { resolveIanaTimeZone } from "../../common/utils/timezone.js";

export interface UpdateInstitutionSettingInput {
  latitude: number;
  longitude: number;
}

export interface UpdateSecuritySettingInput {
  login2faEnabled: boolean;
  sandboxModeEnabled: boolean;
}

export interface GuardianPortalSettings {
  classDetailsEnabled: boolean;
  assessmentsEnabled: boolean;
  entranceExamsEnabled: boolean;
  attendanceEnabled: boolean;
  teacherChatEnabled: boolean;
  teacherPeerChatEnabled: boolean;
}

export interface UpdateGuardianPortalSettingInput {
  classDetailsEnabled: boolean;
  assessmentsEnabled: boolean;
  entranceExamsEnabled: boolean;
  attendanceEnabled: boolean;
  teacherChatEnabled: boolean;
  teacherPeerChatEnabled: boolean;
}

export interface OpenAiSettings {
  configured: boolean;
  openaiApiKey: string | null;
}

export interface UpdateOpenAiSettingInput {
  openaiApiKey: string | null;
}

export type UpdateAdminAiCapabilitySettingsInput = {
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
  briefingConfig?: Partial<AdminAiBriefingConfig> | null;
};

function normalizeBriefingConfig(
  raw:
    | InstitutionSetting["adminAiBriefingConfig"]
    | Partial<AdminAiBriefingConfig>
    | null
    | undefined,
  options?: { recomputeNextRun?: boolean },
): AdminAiBriefingConfig {
  const base = DEFAULT_ADMIN_AI_BRIEFING_CONFIG;
  const time =
    typeof raw?.time === "string" && /^\d{2}:\d{2}$/.test(raw.time.trim())
      ? raw.time.trim()
      : base.time;
  const timeZone = resolveIanaTimeZone(
    typeof raw?.timeZone === "string" ? raw.timeZone : base.timeZone,
  );
  const days = Array.isArray(raw?.daysOfWeek)
    ? raw.daysOfWeek
        .filter((d): d is number => typeof d === "number" && d >= 0 && d <= 6)
        .slice(0, 7)
    : base.daysOfWeek;
  const sectionSet = new Set<string>(ADMIN_AI_BRIEFING_SECTIONS);
  const sections = Array.isArray(raw?.sections)
    ? (raw.sections
        .filter((s): s is string => typeof s === "string" && Boolean(s.trim()))
        .map((s) => s.trim().toLowerCase())
        .filter((s): s is AdminAiBriefingSection => sectionSet.has(s))
        .slice(0, 12) as AdminAiBriefingSection[])
    : base.sections;
  const dateOk = (value: unknown): string | null =>
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
      ? value.trim()
      : null;

  const draft: AdminAiBriefingConfig = {
    time,
    timeZone,
    daysOfWeek: days.length ? days : base.daysOfWeek,
    sections: sections.length ? sections : base.sections,
    startDate: dateOk(raw?.startDate) ?? null,
    endDate: dateOk(raw?.endDate) ?? null,
    nextRunAt:
      typeof raw?.nextRunAt === "string" && raw.nextRunAt.trim()
        ? raw.nextRunAt.trim()
        : null,
    lastRunAt:
      typeof raw?.lastRunAt === "string" && raw.lastRunAt.trim()
        ? raw.lastRunAt.trim()
        : null,
  };

  if (options?.recomputeNextRun !== false) {
    const next = computeNextBriefingRunAt(draft, new Date());
    draft.nextRunAt = next ? next.toISOString() : null;
  }

  return draft;
}

export class SettingsService {
  private readonly settingRepo = AppDataSource.getRepository(InstitutionSetting);

  private async getOrCreateDefault(): Promise<InstitutionSetting> {
    let setting = await this.settingRepo.findOneBy({ id: "default" });
    if (!setting) {
      setting = this.settingRepo.create({
        id: "default",
        latitude: null,
        longitude: null,
        login2faEnabled: false,
        sandboxModeEnabled: false,
        guardianPortalClassDetailsEnabled: false,
        guardianPortalAssessmentsEnabled: false,
        guardianPortalEntranceExamsEnabled: false,
        guardianPortalAttendanceEnabled: false,
        guardianTeacherChatEnabled: false,
        teacherTeacherChatEnabled: false,
        openaiApiKey: null,
        sessionChangeEmailNotificationsEnabled: false,
        adminAiAssistantEnabled: true,
        adminAiDataInsightsEnabled: true,
        adminAiEmailDraftingEnabled: true,
        adminAiMessageDraftingEnabled: true,
        adminAiBulkCommunicationEnabled: true,
        adminAiNotificationSuggestionsEnabled: true,
        adminAiProactiveBriefingEnabled: true,
        adminAiReportBuilderEnabled: true,
        adminAiDeepLinksEnabled: true,
        adminAiConfirmedActionsEnabled: true,
        adminAiBriefingConfig: DEFAULT_ADMIN_AI_BRIEFING_CONFIG,
      });
      setting = await this.settingRepo.save(setting);
    }
    return setting;
  }

  private mapAdminAiCapabilitySettings(
    setting: InstitutionSetting,
  ): AdminAiCapabilitySettings {
    return {
      assistantEnabled: setting.adminAiAssistantEnabled ?? true,
      dataInsightsEnabled: setting.adminAiDataInsightsEnabled ?? true,
      emailDraftingEnabled: setting.adminAiEmailDraftingEnabled ?? true,
      messageDraftingEnabled: setting.adminAiMessageDraftingEnabled ?? true,
      bulkCommunicationEnabled: setting.adminAiBulkCommunicationEnabled ?? true,
      notificationSuggestionsEnabled:
        setting.adminAiNotificationSuggestionsEnabled ?? true,
      proactiveBriefingEnabled: setting.adminAiProactiveBriefingEnabled ?? true,
      reportBuilderEnabled: setting.adminAiReportBuilderEnabled ?? true,
      deepLinksEnabled: setting.adminAiDeepLinksEnabled ?? true,
      confirmedActionsEnabled: setting.adminAiConfirmedActionsEnabled ?? true,
      briefingConfig: normalizeBriefingConfig(setting.adminAiBriefingConfig, {
        recomputeNextRun: false,
      }),
    };
  }

  async getAdminAiCapabilitySettings(): Promise<AdminAiCapabilitySettings> {
    const setting = await this.getOrCreateDefault();
    return this.mapAdminAiCapabilitySettings(setting);
  }

  async updateAdminAiCapabilitySettings(
    input: UpdateAdminAiCapabilitySettingsInput,
  ): Promise<AdminAiCapabilitySettings> {
    const setting = await this.getOrCreateDefault();
    const before = this.mapAdminAiCapabilitySettings(setting);

    setting.adminAiAssistantEnabled = Boolean(input.assistantEnabled);
    setting.adminAiDataInsightsEnabled = Boolean(input.dataInsightsEnabled);
    setting.adminAiEmailDraftingEnabled = Boolean(input.emailDraftingEnabled);
    setting.adminAiMessageDraftingEnabled = Boolean(
      input.messageDraftingEnabled,
    );
    setting.adminAiBulkCommunicationEnabled = Boolean(
      input.bulkCommunicationEnabled,
    );
    setting.adminAiNotificationSuggestionsEnabled = Boolean(
      input.notificationSuggestionsEnabled,
    );
    setting.adminAiProactiveBriefingEnabled = Boolean(
      input.proactiveBriefingEnabled,
    );
    setting.adminAiReportBuilderEnabled = Boolean(input.reportBuilderEnabled);
    setting.adminAiDeepLinksEnabled = Boolean(input.deepLinksEnabled);
    setting.adminAiConfirmedActionsEnabled = Boolean(
      input.confirmedActionsEnabled,
    );
    if (input.briefingConfig != null) {
      setting.adminAiBriefingConfig = normalizeBriefingConfig({
        ...before.briefingConfig,
        ...input.briefingConfig,
        nextRunAt: null,
      });
    }

    await this.settingRepo.save(setting);
    return this.mapAdminAiCapabilitySettings(setting);
  }

  /** Scheduler claim: advance nextRunAt only if still due at expectedNextRunAt. */
  async claimBriefingSchedule(expectedNextRunAt: string): Promise<{
    claimed: boolean;
    config: AdminAiBriefingConfig;
  }> {
    const setting = await this.getOrCreateDefault();
    const current = normalizeBriefingConfig(setting.adminAiBriefingConfig, {
      recomputeNextRun: false,
    });
    if (current.nextRunAt !== expectedNextRunAt) {
      return { claimed: false, config: current };
    }
    const now = new Date();
    const next = computeNextBriefingRunAt(
      current,
      new Date(new Date(expectedNextRunAt).getTime() + 60_000),
    );
    const updated: AdminAiBriefingConfig = {
      ...current,
      lastRunAt: now.toISOString(),
      nextRunAt: next ? next.toISOString() : null,
    };
    setting.adminAiBriefingConfig = updated;
    await this.settingRepo.save(setting);
    return { claimed: true, config: updated };
  }

  async ensureBriefingNextRunAt(): Promise<AdminAiBriefingConfig> {
    const setting = await this.getOrCreateDefault();
    const current = normalizeBriefingConfig(setting.adminAiBriefingConfig, {
      recomputeNextRun: false,
    });
    if (current.nextRunAt) return current;
    const next = computeNextBriefingRunAt(current, new Date());
    const updated: AdminAiBriefingConfig = {
      ...current,
      nextRunAt: next ? next.toISOString() : null,
    };
    setting.adminAiBriefingConfig = updated;
    await this.settingRepo.save(setting);
    return updated;
  }

  async getInstitutionSettings(): Promise<InstitutionSetting | null> {
    return this.settingRepo.findOneBy({ id: "default" });
  }

  async updateInstitutionSettings(
    input: UpdateInstitutionSettingInput,
  ): Promise<InstitutionSetting> {
    const setting = await this.getOrCreateDefault();
    setting.latitude = input.latitude;
    setting.longitude = input.longitude;
    return this.settingRepo.save(setting);
  }

  async getSecuritySettings(): Promise<{
    login2faEnabled: boolean;
    sandboxModeEnabled: boolean;
  }> {
    const setting = await this.getOrCreateDefault();
    return {
      login2faEnabled: setting.login2faEnabled ?? false,
      sandboxModeEnabled: setting.sandboxModeEnabled ?? false,
    };
  }

  async updateSecuritySettings(
    input: UpdateSecuritySettingInput,
  ): Promise<{ login2faEnabled: boolean; sandboxModeEnabled: boolean }> {
    const setting = await this.getOrCreateDefault();
    setting.login2faEnabled = input.login2faEnabled;
    setting.sandboxModeEnabled = input.sandboxModeEnabled;
    await this.settingRepo.save(setting);
    return {
      login2faEnabled: setting.login2faEnabled,
      sandboxModeEnabled: setting.sandboxModeEnabled,
    };
  }

  async isLogin2faEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.login2faEnabled ?? false;
  }

  async isSandboxModeEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.sandboxModeEnabled ?? false;
  }

  private mapGuardianPortalSettings(
    setting: InstitutionSetting,
  ): GuardianPortalSettings {
    return {
      classDetailsEnabled: setting.guardianPortalClassDetailsEnabled ?? false,
      assessmentsEnabled: setting.guardianPortalAssessmentsEnabled ?? false,
      entranceExamsEnabled: setting.guardianPortalEntranceExamsEnabled ?? false,
      attendanceEnabled: setting.guardianPortalAttendanceEnabled ?? false,
      teacherChatEnabled: setting.guardianTeacherChatEnabled ?? false,
      teacherPeerChatEnabled: setting.teacherTeacherChatEnabled ?? false,
    };
  }

  async getGuardianPortalSettings(): Promise<GuardianPortalSettings> {
    const setting = await this.getOrCreateDefault();
    return this.mapGuardianPortalSettings(setting);
  }

  async updateGuardianPortalSettings(
    input: UpdateGuardianPortalSettingInput,
    options?: { allowTeacherChatToggle?: boolean },
  ): Promise<GuardianPortalSettings> {
    const setting = await this.getOrCreateDefault();
    setting.guardianPortalClassDetailsEnabled = input.classDetailsEnabled;
    setting.guardianPortalAssessmentsEnabled = input.assessmentsEnabled;
    setting.guardianPortalEntranceExamsEnabled = input.entranceExamsEnabled;
    setting.guardianPortalAttendanceEnabled = input.attendanceEnabled;
    if (options?.allowTeacherChatToggle) {
      setting.guardianTeacherChatEnabled = input.teacherChatEnabled;
      setting.teacherTeacherChatEnabled = input.teacherPeerChatEnabled;
    }
    await this.settingRepo.save(setting);
    return this.mapGuardianPortalSettings(setting);
  }

  async isGuardianPortalClassDetailsEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.guardianPortalClassDetailsEnabled ?? false;
  }

  async isGuardianPortalAssessmentsEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.guardianPortalAssessmentsEnabled ?? false;
  }

  async isGuardianPortalEntranceExamsEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.guardianPortalEntranceExamsEnabled ?? false;
  }

  async isGuardianPortalAttendanceEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.guardianPortalAttendanceEnabled ?? false;
  }

  async isGuardianTeacherChatEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.guardianTeacherChatEnabled ?? false;
  }

  async isTeacherTeacherChatEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.teacherTeacherChatEnabled ?? false;
  }

  async getOpenAiSettings(): Promise<OpenAiSettings> {
    const setting = await this.getOrCreateDefault();
    const openaiApiKey = setting.openaiApiKey?.trim() || null;
    return {
      configured: Boolean(openaiApiKey),
      openaiApiKey,
    };
  }

  async updateOpenAiSettings(
    input: UpdateOpenAiSettingInput,
  ): Promise<OpenAiSettings> {
    const setting = await this.getOrCreateDefault();
    const openaiApiKey = input.openaiApiKey?.trim() || null;
    setting.openaiApiKey = openaiApiKey;
    await this.settingRepo.save(setting);
    return {
      configured: Boolean(openaiApiKey),
      openaiApiKey,
    };
  }

  async getOpenAiApiKey(): Promise<string | null> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.openaiApiKey?.trim() || null;
  }

  async getNotificationSettings(): Promise<{
    sessionChangeEmailNotificationsEnabled: boolean;
  }> {
    const setting = await this.getOrCreateDefault();
    return {
      sessionChangeEmailNotificationsEnabled:
        setting.sessionChangeEmailNotificationsEnabled ?? false,
    };
  }

  async updateNotificationSettings(input: {
    sessionChangeEmailNotificationsEnabled: boolean;
  }): Promise<{ sessionChangeEmailNotificationsEnabled: boolean }> {
    const setting = await this.getOrCreateDefault();
    setting.sessionChangeEmailNotificationsEnabled =
      input.sessionChangeEmailNotificationsEnabled;
    await this.settingRepo.save(setting);
    return {
      sessionChangeEmailNotificationsEnabled:
        setting.sessionChangeEmailNotificationsEnabled,
    };
  }

  async isSessionChangeEmailNotificationsEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.sessionChangeEmailNotificationsEnabled ?? false;
  }
}

export const settingsService = new SettingsService();
