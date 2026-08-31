import { AppDataSource } from "../../config/data-source.js";
import { InstitutionSetting } from "../../entities/index.js";

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
}

export interface UpdateGuardianPortalSettingInput {
  classDetailsEnabled: boolean;
  assessmentsEnabled: boolean;
  entranceExamsEnabled: boolean;
  attendanceEnabled: boolean;
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
      });
      setting = await this.settingRepo.save(setting);
    }
    return setting;
  }

  async getInstitutionSettings(): Promise<InstitutionSetting | null> {
    return this.settingRepo.findOneBy({ id: "default" });
  }

  async updateInstitutionSettings(input: UpdateInstitutionSettingInput): Promise<InstitutionSetting> {
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
    };
  }

  async getGuardianPortalSettings(): Promise<GuardianPortalSettings> {
    const setting = await this.getOrCreateDefault();
    return this.mapGuardianPortalSettings(setting);
  }

  async updateGuardianPortalSettings(
    input: UpdateGuardianPortalSettingInput,
  ): Promise<GuardianPortalSettings> {
    const setting = await this.getOrCreateDefault();
    setting.guardianPortalClassDetailsEnabled = input.classDetailsEnabled;
    setting.guardianPortalAssessmentsEnabled = input.assessmentsEnabled;
    setting.guardianPortalEntranceExamsEnabled = input.entranceExamsEnabled;
    setting.guardianPortalAttendanceEnabled = input.attendanceEnabled;
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
}

export const settingsService = new SettingsService();
