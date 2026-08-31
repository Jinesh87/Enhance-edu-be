import type { Request, Response } from "express";
import { settingsService } from "../../settings/settings.service.js";

export class GuardianPortalController {
  async getPortalSettings(_req: Request, res: Response): Promise<void> {
    const settings = await settingsService.getGuardianPortalSettings();
    res.json(settings);
  }
}

export const guardianPortalController = new GuardianPortalController();
