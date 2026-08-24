import type { Request, Response } from "express";
import { settingsService } from "./settings.service.js";
import { logger } from "../../config/logger.js";

export class SettingsController {
  async getInstitutionSettings(req: Request, res: Response): Promise<void> {
    const config = await settingsService.getInstitutionSettings();

    if (!config) {
      res.json({
        configured: false,
        latitude: null,
        longitude: null,
      });
      return;
    }

    res.json({
      configured: true,
      latitude: config.latitude,
      longitude: config.longitude,
    });
  }

  async updateInstitutionSettings(req: Request, res: Response): Promise<void> {
    const config = await settingsService.updateInstitutionSettings(req.body);

    logger.info(
      { userId: req.user?.id },
      "Institution location coordinates updated by Super Admin",
    );

    res.json({
      configured: true,
      latitude: config.latitude,
      longitude: config.longitude,
    });
  }

  async getSecuritySettings(_req: Request, res: Response): Promise<void> {
    const config = await settingsService.getSecuritySettings();
    res.json(config);
  }

  async updateSecuritySettings(req: Request, res: Response): Promise<void> {
    const config = await settingsService.updateSecuritySettings(req.body);

    logger.info(
      { userId: req.user?.id, login2faEnabled: config.login2faEnabled },
      "Login 2FA setting updated by Super Admin",
    );

    res.json(config);
  }
}

export const settingsController = new SettingsController();
