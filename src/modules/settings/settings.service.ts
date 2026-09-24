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
import { emailService } from "../email/email.service.js";

function clampDigestHour(value: number | null | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 19;
  return Math.min(23, Math.max(0, Math.trunc(n)));
}

export interface UpdateInstitutionSettingInput {
  latitude: number;
  longitude: number;
}

export interface UpdateSecuritySettingInput {
  login2faEnabled: boolean;
  sandboxModeEnabled: boolean;
  teacherPayrollEnabled: boolean;
}

export interface GuardianPortalSettings {
  classDetailsEnabled: boolean;
  assessmentsEnabled: boolean;
  entranceExamsEnabled: boolean;
  attendanceEnabled: boolean;
  teacherChatEnabled: boolean;
  teacherPeerChatEnabled: boolean;
  adminChatEnabled: boolean;
  officeStaffChatEnabled: boolean;
  studentAdminChatEnabled: boolean;
  officeTeacherChatEnabled: boolean;
  officeAdminChatEnabled: boolean;
  teacherAdminChatEnabled: boolean;
}

export interface UpdateGuardianPortalSettingInput {
  classDetailsEnabled: boolean;
  assessmentsEnabled: boolean;
  entranceExamsEnabled: boolean;
  attendanceEnabled: boolean;
  teacherChatEnabled: boolean;
  teacherPeerChatEnabled: boolean;
  adminChatEnabled: boolean;
  officeStaffChatEnabled: boolean;
  studentAdminChatEnabled: boolean;
  officeTeacherChatEnabled: boolean;
  officeAdminChatEnabled: boolean;
  teacherAdminChatEnabled: boolean;
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
        teacherPayrollEnabled: false,
        guardianPortalClassDetailsEnabled: false,
        guardianPortalAssessmentsEnabled: false,
        guardianPortalEntranceExamsEnabled: false,
        guardianPortalAttendanceEnabled: false,
        guardianTeacherChatEnabled: false,
        teacherTeacherChatEnabled: false,
        guardianAdminChatEnabled: false,
        officeStaffChatEnabled: false,
        studentAdminChatEnabled: false,
        officeTeacherChatEnabled: false,
        officeAdminChatEnabled: false,
        teacherAdminChatEnabled: false,
        openaiApiKey: null,
        sessionChangeEmailNotificationsEnabled: false,
        classReminderDigestEnabled: true,
        classReminder1hPushEnabled: true,
        classReminderDigestHour: 19,
        urgentCancelSmsEnabled: true,
        termScheduleEmailNotificationsEnabled: true,
        absenceAlertInAppEnabled: true,
        absenceAlertEmailEnabled: true,
        absenceAlertSmsEnabled: true,
        homeworkCreatedInAppEnabled: true,
        homeworkDueSoonEnabled: true,
        homeworkOverdueInAppEnabled: true,
        homeworkOverdueEmailEnabled: true,
        homeworkGradedEnabled: true,
        homeworkSubmittedEnabled: true,
        enquiryCreatedNotifyEnabled: true,
        trialBookingConfirmedNotifyEnabled: true,
        enrollmentAcceptedNotifyEnabled: true,
        classRosterStudentAddedNotifyEnabled: true,
        holidayReminderInAppEnabled: true,
        holidayReminderEmailEnabled: true,
        announcementEmailEnabled: true,
        emergencyAlertInAppEnabled: true,
        emergencyAlertEmailEnabled: true,
        emergencyAlertSmsEnabled: true,
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
    teacherPayrollEnabled: boolean;
  }> {
    const setting = await this.getOrCreateDefault();
    return {
      login2faEnabled: setting.login2faEnabled ?? false,
      sandboxModeEnabled: setting.sandboxModeEnabled ?? false,
      teacherPayrollEnabled: setting.teacherPayrollEnabled ?? false,
    };
  }

  async updateSecuritySettings(
    input: UpdateSecuritySettingInput,
  ): Promise<{
    login2faEnabled: boolean;
    sandboxModeEnabled: boolean;
    teacherPayrollEnabled: boolean;
  }> {
    const setting = await this.getOrCreateDefault();
    setting.login2faEnabled = input.login2faEnabled;
    setting.sandboxModeEnabled = input.sandboxModeEnabled;
    setting.teacherPayrollEnabled = input.teacherPayrollEnabled;
    await this.settingRepo.save(setting);
    return {
      login2faEnabled: setting.login2faEnabled,
      sandboxModeEnabled: setting.sandboxModeEnabled,
      teacherPayrollEnabled: setting.teacherPayrollEnabled,
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

  async isTeacherPayrollEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.teacherPayrollEnabled ?? false;
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
      adminChatEnabled: setting.guardianAdminChatEnabled ?? false,
      officeStaffChatEnabled: setting.officeStaffChatEnabled ?? false,
      studentAdminChatEnabled: setting.studentAdminChatEnabled ?? false,
      officeTeacherChatEnabled: setting.officeTeacherChatEnabled ?? false,
      officeAdminChatEnabled: setting.officeAdminChatEnabled ?? false,
      teacherAdminChatEnabled: setting.teacherAdminChatEnabled ?? false,
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
      setting.guardianAdminChatEnabled = input.adminChatEnabled;
      setting.officeStaffChatEnabled = input.officeStaffChatEnabled;
      setting.studentAdminChatEnabled = input.studentAdminChatEnabled;
      setting.officeTeacherChatEnabled = input.officeTeacherChatEnabled;
      setting.officeAdminChatEnabled = input.officeAdminChatEnabled;
      setting.teacherAdminChatEnabled = input.teacherAdminChatEnabled;
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

  async isGuardianAdminChatEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.guardianAdminChatEnabled ?? false;
  }

  async isOfficeStaffChatEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.officeStaffChatEnabled ?? false;
  }

  async isStudentAdminChatEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.studentAdminChatEnabled ?? false;
  }

  async isOfficeTeacherChatEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.officeTeacherChatEnabled ?? false;
  }

  async isOfficeAdminChatEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.officeAdminChatEnabled ?? false;
  }

  async isTeacherAdminChatEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.teacherAdminChatEnabled ?? false;
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
    classReminderDigestEnabled: boolean;
    classReminder1hPushEnabled: boolean;
    classReminderDigestHour: number;
    urgentCancelSmsEnabled: boolean;
    termScheduleEmailNotificationsEnabled: boolean;
    absenceAlertInAppEnabled: boolean;
    absenceAlertEmailEnabled: boolean;
    absenceAlertSmsEnabled: boolean;
    homeworkCreatedInAppEnabled: boolean;
    homeworkDueSoonEnabled: boolean;
    homeworkOverdueInAppEnabled: boolean;
    homeworkOverdueEmailEnabled: boolean;
    homeworkGradedEnabled: boolean;
    homeworkSubmittedEnabled: boolean;
    enquiryCreatedNotifyEnabled: boolean;
    trialBookingConfirmedNotifyEnabled: boolean;
    enrollmentAcceptedNotifyEnabled: boolean;
    classRosterStudentAddedNotifyEnabled: boolean;
    holidayReminderInAppEnabled: boolean;
    holidayReminderEmailEnabled: boolean;
    announcementEmailEnabled: boolean;
    emergencyAlertInAppEnabled: boolean;
    emergencyAlertEmailEnabled: boolean;
    emergencyAlertSmsEnabled: boolean;
    smsConfigured: boolean;
  }> {
    const setting = await this.getOrCreateDefault();
    const messaging = await emailService.getConfig();
    const smsConfigured = Boolean(
      messaging?.smsEnabled &&
        messaging.twilioAccountSid &&
        messaging.twilioAuthToken &&
        messaging.twilioFromNumber,
    );
    return {
      sessionChangeEmailNotificationsEnabled:
        setting.sessionChangeEmailNotificationsEnabled ?? false,
      classReminderDigestEnabled: setting.classReminderDigestEnabled ?? true,
      classReminder1hPushEnabled: setting.classReminder1hPushEnabled ?? true,
      classReminderDigestHour: clampDigestHour(setting.classReminderDigestHour),
      urgentCancelSmsEnabled: setting.urgentCancelSmsEnabled ?? true,
      termScheduleEmailNotificationsEnabled:
        setting.termScheduleEmailNotificationsEnabled ?? true,
      absenceAlertInAppEnabled: setting.absenceAlertInAppEnabled ?? true,
      absenceAlertEmailEnabled: setting.absenceAlertEmailEnabled ?? true,
      absenceAlertSmsEnabled: setting.absenceAlertSmsEnabled ?? true,
      homeworkCreatedInAppEnabled: setting.homeworkCreatedInAppEnabled ?? true,
      homeworkDueSoonEnabled: setting.homeworkDueSoonEnabled ?? true,
      homeworkOverdueInAppEnabled: setting.homeworkOverdueInAppEnabled ?? true,
      homeworkOverdueEmailEnabled: setting.homeworkOverdueEmailEnabled ?? true,
      homeworkGradedEnabled: setting.homeworkGradedEnabled ?? true,
      homeworkSubmittedEnabled: setting.homeworkSubmittedEnabled ?? true,
      enquiryCreatedNotifyEnabled: setting.enquiryCreatedNotifyEnabled ?? true,
      trialBookingConfirmedNotifyEnabled:
        setting.trialBookingConfirmedNotifyEnabled ?? true,
      enrollmentAcceptedNotifyEnabled:
        setting.enrollmentAcceptedNotifyEnabled ?? true,
      classRosterStudentAddedNotifyEnabled:
        setting.classRosterStudentAddedNotifyEnabled ?? true,
      holidayReminderInAppEnabled: setting.holidayReminderInAppEnabled ?? true,
      holidayReminderEmailEnabled: setting.holidayReminderEmailEnabled ?? true,
      announcementEmailEnabled: setting.announcementEmailEnabled ?? true,
      emergencyAlertInAppEnabled: setting.emergencyAlertInAppEnabled ?? true,
      emergencyAlertEmailEnabled: setting.emergencyAlertEmailEnabled ?? true,
      emergencyAlertSmsEnabled: setting.emergencyAlertSmsEnabled ?? true,
      smsConfigured,
    };
  }

  async updateNotificationSettings(input: {
    sessionChangeEmailNotificationsEnabled: boolean;
    classReminderDigestEnabled: boolean;
    classReminder1hPushEnabled: boolean;
    classReminderDigestHour: number;
    urgentCancelSmsEnabled: boolean;
    termScheduleEmailNotificationsEnabled: boolean;
    absenceAlertInAppEnabled: boolean;
    absenceAlertEmailEnabled: boolean;
    absenceAlertSmsEnabled: boolean;
    homeworkCreatedInAppEnabled: boolean;
    homeworkDueSoonEnabled: boolean;
    homeworkOverdueInAppEnabled: boolean;
    homeworkOverdueEmailEnabled: boolean;
    homeworkGradedEnabled: boolean;
    homeworkSubmittedEnabled: boolean;
    enquiryCreatedNotifyEnabled: boolean;
    trialBookingConfirmedNotifyEnabled: boolean;
    enrollmentAcceptedNotifyEnabled: boolean;
    classRosterStudentAddedNotifyEnabled: boolean;
    holidayReminderInAppEnabled: boolean;
    holidayReminderEmailEnabled: boolean;
    announcementEmailEnabled: boolean;
    emergencyAlertInAppEnabled: boolean;
    emergencyAlertEmailEnabled: boolean;
    emergencyAlertSmsEnabled: boolean;
  }): Promise<{
    sessionChangeEmailNotificationsEnabled: boolean;
    classReminderDigestEnabled: boolean;
    classReminder1hPushEnabled: boolean;
    classReminderDigestHour: number;
    urgentCancelSmsEnabled: boolean;
    termScheduleEmailNotificationsEnabled: boolean;
    absenceAlertInAppEnabled: boolean;
    absenceAlertEmailEnabled: boolean;
    absenceAlertSmsEnabled: boolean;
    homeworkCreatedInAppEnabled: boolean;
    homeworkDueSoonEnabled: boolean;
    homeworkOverdueInAppEnabled: boolean;
    homeworkOverdueEmailEnabled: boolean;
    homeworkGradedEnabled: boolean;
    homeworkSubmittedEnabled: boolean;
    enquiryCreatedNotifyEnabled: boolean;
    trialBookingConfirmedNotifyEnabled: boolean;
    enrollmentAcceptedNotifyEnabled: boolean;
    classRosterStudentAddedNotifyEnabled: boolean;
    holidayReminderInAppEnabled: boolean;
    holidayReminderEmailEnabled: boolean;
    announcementEmailEnabled: boolean;
    emergencyAlertInAppEnabled: boolean;
    emergencyAlertEmailEnabled: boolean;
    emergencyAlertSmsEnabled: boolean;
    smsConfigured: boolean;
  }> {
    const setting = await this.getOrCreateDefault();
    setting.sessionChangeEmailNotificationsEnabled =
      input.sessionChangeEmailNotificationsEnabled;
    setting.classReminderDigestEnabled = input.classReminderDigestEnabled;
    setting.classReminder1hPushEnabled = input.classReminder1hPushEnabled;
    setting.classReminderDigestHour = clampDigestHour(
      input.classReminderDigestHour,
    );
    setting.urgentCancelSmsEnabled = input.urgentCancelSmsEnabled;
    setting.termScheduleEmailNotificationsEnabled =
      input.termScheduleEmailNotificationsEnabled;
    setting.absenceAlertInAppEnabled = input.absenceAlertInAppEnabled;
    setting.absenceAlertEmailEnabled = input.absenceAlertEmailEnabled;
    setting.absenceAlertSmsEnabled = input.absenceAlertSmsEnabled;
    setting.homeworkCreatedInAppEnabled = input.homeworkCreatedInAppEnabled;
    setting.homeworkDueSoonEnabled = input.homeworkDueSoonEnabled;
    setting.homeworkOverdueInAppEnabled = input.homeworkOverdueInAppEnabled;
    setting.homeworkOverdueEmailEnabled = input.homeworkOverdueEmailEnabled;
    setting.homeworkGradedEnabled = input.homeworkGradedEnabled;
    setting.homeworkSubmittedEnabled = input.homeworkSubmittedEnabled;
    setting.enquiryCreatedNotifyEnabled = input.enquiryCreatedNotifyEnabled;
    setting.trialBookingConfirmedNotifyEnabled =
      input.trialBookingConfirmedNotifyEnabled;
    setting.enrollmentAcceptedNotifyEnabled =
      input.enrollmentAcceptedNotifyEnabled;
    setting.classRosterStudentAddedNotifyEnabled =
      input.classRosterStudentAddedNotifyEnabled;
    setting.holidayReminderInAppEnabled = input.holidayReminderInAppEnabled;
    setting.holidayReminderEmailEnabled = input.holidayReminderEmailEnabled;
    setting.announcementEmailEnabled = input.announcementEmailEnabled;
    setting.emergencyAlertInAppEnabled = input.emergencyAlertInAppEnabled;
    setting.emergencyAlertEmailEnabled = input.emergencyAlertEmailEnabled;
    setting.emergencyAlertSmsEnabled = input.emergencyAlertSmsEnabled;
    await this.settingRepo.save(setting);
    return this.getNotificationSettings();
  }

  async isSessionChangeEmailNotificationsEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.sessionChangeEmailNotificationsEnabled ?? false;
  }

  async isClassReminderDigestEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.classReminderDigestEnabled ?? true;
  }

  async isClassReminder1hPushEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.classReminder1hPushEnabled ?? true;
  }

  async isUrgentCancelSmsEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.urgentCancelSmsEnabled ?? true;
  }

  async isTermScheduleEmailNotificationsEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.termScheduleEmailNotificationsEnabled ?? true;
  }

  async isAbsenceAlertInAppEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.absenceAlertInAppEnabled ?? true;
  }

  async isAbsenceAlertEmailEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.absenceAlertEmailEnabled ?? true;
  }

  async isAbsenceAlertSmsEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.absenceAlertSmsEnabled ?? true;
  }

  async isHomeworkCreatedInAppEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.homeworkCreatedInAppEnabled ?? true;
  }

  async isHomeworkDueSoonEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.homeworkDueSoonEnabled ?? true;
  }

  async isHomeworkOverdueInAppEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.homeworkOverdueInAppEnabled ?? true;
  }

  async isHomeworkOverdueEmailEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.homeworkOverdueEmailEnabled ?? true;
  }

  async isHomeworkGradedEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.homeworkGradedEnabled ?? true;
  }

  async isHomeworkSubmittedEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.homeworkSubmittedEnabled ?? true;
  }

  async isEnquiryCreatedNotifyEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.enquiryCreatedNotifyEnabled ?? true;
  }

  async isTrialBookingConfirmedNotifyEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.trialBookingConfirmedNotifyEnabled ?? true;
  }

  async isEnrollmentAcceptedNotifyEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.enrollmentAcceptedNotifyEnabled ?? true;
  }

  async isClassRosterStudentAddedNotifyEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.classRosterStudentAddedNotifyEnabled ?? true;
  }

  async isHolidayReminderInAppEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.holidayReminderInAppEnabled ?? true;
  }

  async isHolidayReminderEmailEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.holidayReminderEmailEnabled ?? true;
  }

  async isAnnouncementEmailEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.announcementEmailEnabled ?? true;
  }

  async isEmergencyAlertInAppEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.emergencyAlertInAppEnabled ?? true;
  }

  async isEmergencyAlertEmailEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.emergencyAlertEmailEnabled ?? true;
  }

  async isEmergencyAlertSmsEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.emergencyAlertSmsEnabled ?? true;
  }

  async getClassReminderDigestHour(): Promise<number> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return clampDigestHour(setting?.classReminderDigestHour);
  }
}

export const settingsService = new SettingsService();
