import { AppDataSource } from "../../config/data-source.js";
import { InstitutionSetting } from "../../entities/index.js";

export interface UpdateInstitutionSettingInput {
  latitude: number;
  longitude: number;
}

export class SettingsService {
  private readonly settingRepo = AppDataSource.getRepository(InstitutionSetting);

  async getInstitutionSettings(): Promise<InstitutionSetting | null> {
    return this.settingRepo.findOneBy({ id: "default" });
  }

  async updateInstitutionSettings(input: UpdateInstitutionSettingInput): Promise<InstitutionSetting> {
    let setting = await this.settingRepo.findOneBy({ id: "default" });
    if (!setting) {
      setting = this.settingRepo.create({
        id: "default",
        latitude: input.latitude,
        longitude: input.longitude,
      });
    } else {
      setting.latitude = input.latitude;
      setting.longitude = input.longitude;
    }
    return this.settingRepo.save(setting);
  }
}

export const settingsService = new SettingsService();
