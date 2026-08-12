import type { Request, Response } from "express";
import { emailService } from "./email.service.js";
import { logger } from "../../config/logger.js";

export class EmailController {
  async getConfig(_req: Request, res: Response): Promise<void> {
    const config = await emailService.getConfig();

    if (!config) {
      res.json({
        configured: false,
        fromEmail: null,
        fromName: null,
        enabled: false,
      });
      return;
    }

    res.json({
      configured: true,
      fromEmail: config.fromEmail,
      fromName: config.fromName,
      enabled: config.enabled,
      // Never send the API key to the client
    });
  }

  async updateConfig(req: Request, res: Response): Promise<void> {
    const { resendApiKey, fromEmail, fromName, enabled } = req.body;

    const config = await emailService.updateConfig(
      resendApiKey,
      fromEmail,
      fromName,
      enabled,
    );

    logger.info(
      { userId: req.user?.id },
      "Email configuration updated by Super Admin",
    );

    res.json({
      configured: true,
      fromEmail: config.fromEmail,
      fromName: config.fromName,
      enabled: config.enabled,
    });
  }
}

export const emailController = new EmailController();
