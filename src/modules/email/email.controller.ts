import type { Request, Response } from "express";
import { emailService } from "./email.service.js";
import { logger } from "../../config/logger.js";

export class EmailController {
  async getConfig(_req: Request, res: Response): Promise<void> {
    const config = await emailService.getConfig();

    if (!config) {
      res.json({
        configured: false,
        resendApiKey: null,
        fromEmail: null,
        fromName: null,
        enabled: false,
        twilioAccountSid: null,
        twilioAuthToken: null,
        twilioConfigured: false,
        twilioFromNumber: null,
        smsEnabled: false,
      });
      return;
    }

    res.json({
      configured: true,
      resendApiKey: config.resendApiKey,
      fromEmail: config.fromEmail,
      fromName: config.fromName,
      enabled: config.enabled,
      twilioAccountSid: config.twilioAccountSid,
      twilioAuthToken: config.twilioAuthToken,
      twilioConfigured: Boolean(
        config.twilioAccountSid &&
          config.twilioAuthToken &&
          config.twilioFromNumber,
      ),
      twilioFromNumber: config.twilioFromNumber,
      smsEnabled: config.smsEnabled,
    });
  }

  async updateConfig(req: Request, res: Response): Promise<void> {
    const config = await emailService.updateConfig(req.body);

    logger.info(
      { userId: req.user?.id },
      "Email configuration updated by Super Admin",
    );

    res.json({
      configured: true,
      resendApiKey: config.resendApiKey,
      fromEmail: config.fromEmail,
      fromName: config.fromName,
      enabled: config.enabled,
      twilioAccountSid: config.twilioAccountSid,
      twilioAuthToken: config.twilioAuthToken,
      twilioConfigured: Boolean(
        config.twilioAccountSid &&
          config.twilioAuthToken &&
          config.twilioFromNumber,
      ),
      twilioFromNumber: config.twilioFromNumber,
      smsEnabled: config.smsEnabled,
    });
  }
}

export const emailController = new EmailController();
