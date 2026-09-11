import type { Request, Response } from "express";
import { settingsService } from "./settings.service.js";
import { logger } from "../../config/logger.js";
import { openAiUsageService } from "../../common/ai/openai-usage.service.js";
import { writeAuditLog } from "../../common/utils/audit-log.js";

function parseOptionalDate(value: unknown, endOfDay = false): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const raw = value.trim();
  const date = new Date(raw.length === 10 ? `${raw}T00:00:00.000Z` : raw);
  if (Number.isNaN(date.getTime())) return undefined;
  if (endOfDay && raw.length === 10) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date;
}

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
      {
        userId: req.user?.id,
        login2faEnabled: config.login2faEnabled,
        sandboxModeEnabled: config.sandboxModeEnabled,
      },
      "Security settings updated by Super Admin",
    );

    res.json(config);
  }

  async getSandboxMode(_req: Request, res: Response): Promise<void> {
    const sandboxModeEnabled = await settingsService.isSandboxModeEnabled();
    res.json({ sandboxModeEnabled });
  }

  async getGuardianPortalSettings(_req: Request, res: Response): Promise<void> {
    const config = await settingsService.getGuardianPortalSettings();
    res.json(config);
  }

  async updateGuardianPortalSettings(req: Request, res: Response): Promise<void> {
    const config = await settingsService.updateGuardianPortalSettings(req.body);

    logger.info(
      {
        userId: req.user?.id,
        ...config,
      },
      "Guardian portal settings updated",
    );

    res.json(config);
  }

  async getOpenAiSettings(_req: Request, res: Response): Promise<void> {
    const config = await settingsService.getOpenAiSettings();
    res.json(config);
  }

  async updateOpenAiSettings(req: Request, res: Response): Promise<void> {
    const config = await settingsService.updateOpenAiSettings({
      openaiApiKey: req.body.openaiApiKey ?? null,
    });

    logger.info(
      {
        userId: req.user?.id,
        configured: config.configured,
      },
      "OpenAI settings updated",
    );

    res.json(config);
  }

  async getNotificationSettings(_req: Request, res: Response): Promise<void> {
    const config = await settingsService.getNotificationSettings();
    res.json(config);
  }

  async updateNotificationSettings(req: Request, res: Response): Promise<void> {
    const config = await settingsService.updateNotificationSettings(req.body);

    logger.info(
      {
        userId: req.user?.id,
        ...config,
      },
      "Notification settings updated",
    );

    res.json(config);
  }

  async getAdminAiCapabilitySettings(_req: Request, res: Response): Promise<void> {
    const config = await settingsService.getAdminAiCapabilitySettings();
    res.json(config);
  }

  async updateAdminAiCapabilitySettings(
    req: Request,
    res: Response,
  ): Promise<void> {
    const before = await settingsService.getAdminAiCapabilitySettings();
    const config = await settingsService.updateAdminAiCapabilitySettings(
      req.body,
    );

    logger.info(
      {
        userId: req.user?.id,
        before,
        after: config,
      },
      "Admin AI capability settings updated",
    );

    await writeAuditLog({
      actorUserId: req.user?.id ?? null,
      action: "EDITED",
      recordType: "admin_ai_settings",
      recordId: "default",
      recordLabel: "Admin AI Settings",
      recordPath: "/admin/ai-settings",
      before: before as unknown as Record<string, unknown>,
      after: config as unknown as Record<string, unknown>,
    });

    res.json(config);
  }

  async getOpenAiUsageSummary(req: Request, res: Response): Promise<void> {
    const summary = await openAiUsageService.getSummary({
      from: parseOptionalDate(req.query.from),
      to: parseOptionalDate(req.query.to, true),
    });
    res.json(summary);
  }

  async listOpenAiUsage(req: Request, res: Response): Promise<void> {
    const status =
      req.query.status === "success" || req.query.status === "error"
        ? req.query.status
        : undefined;
    const data = await openAiUsageService.list({
      from: parseOptionalDate(req.query.from),
      to: parseOptionalDate(req.query.to, true),
      feature:
        typeof req.query.feature === "string" ? req.query.feature : undefined,
      status,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json(data);
  }
}

export const settingsController = new SettingsController();
