import { AppDataSource } from "../../config/data-source.js";
import { InstitutionSetting } from "../../entities/index.js";

export interface UpdateInstitutionSettingInput {
  latitude: number;
  longitude: number;
}

export interface UpdateSecuritySettingInput {
  login2faEnabled: boolean;
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

  async getSecuritySettings(): Promise<{ login2faEnabled: boolean }> {
    const setting = await this.getOrCreateDefault();
    return { login2faEnabled: setting.login2faEnabled ?? false };
  }

  async updateSecuritySettings(
    input: UpdateSecuritySettingInput,
  ): Promise<{ login2faEnabled: boolean }> {
    const setting = await this.getOrCreateDefault();
    setting.login2faEnabled = input.login2faEnabled;
    await this.settingRepo.save(setting);
    return { login2faEnabled: setting.login2faEnabled };
  }

  async isLogin2faEnabled(): Promise<boolean> {
    const setting = await this.settingRepo.findOneBy({ id: "default" });
    return setting?.login2faEnabled ?? false;
  }
}

export const settingsService = new SettingsService();
