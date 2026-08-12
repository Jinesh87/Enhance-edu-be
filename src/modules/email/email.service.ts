import { Resend } from "resend";
import twilio from "twilio";
import { AppDataSource } from "../../config/data-source.js";
import { logger } from "../../config/logger.js";
import { AppError } from "../../common/errors/AppError.js";
import { MessagingConfig } from "../../entities/EmailConfig.js";

export interface SendInvitationEmailParams {
  to: string;
  fullName: string;
  invitationLink: string;
}

export interface SendSecurityCodeEmailParams {
  to: string;
  fullName: string;
  code: string;
}

export interface SendSecurityCodeSmsParams {
  to: string;
  fullName: string;
  code: string;
}

export interface UpdateMessagingConfigInput {
  resendApiKey: string;
  fromEmail: string;
  fromName: string;
  enabled: boolean;
  twilioAccountSid?: string | null;
  twilioAuthToken?: string | null;
  twilioFromNumber?: string | null;
  smsEnabled: boolean;
}

export class EmailService {
  private readonly configRepo = AppDataSource.getRepository(MessagingConfig);

  async getConfig(): Promise<MessagingConfig | null> {
    return this.configRepo.findOne({ where: { id: "default" } });
  }

  async updateConfig(input: UpdateMessagingConfigInput): Promise<MessagingConfig> {
    let config = await this.configRepo.findOne({ where: { id: "default" } });

    const twilioAccountSid = input.twilioAccountSid?.trim() || null;
    const twilioAuthToken = input.twilioAuthToken?.trim() || null;
    const twilioFromNumber = input.twilioFromNumber?.trim() || null;

    if (!config) {
      config = this.configRepo.create({
        id: "default",
        resendApiKey: input.resendApiKey,
        fromEmail: input.fromEmail,
        fromName: input.fromName,
        enabled: input.enabled,
        twilioAccountSid,
        twilioAuthToken,
        twilioFromNumber,
        smsEnabled: input.smsEnabled,
      });
    } else {
      config.resendApiKey = input.resendApiKey;
      config.fromEmail = input.fromEmail;
      config.fromName = input.fromName;
      config.enabled = input.enabled;
      config.twilioAccountSid = twilioAccountSid;
      config.twilioAuthToken = twilioAuthToken;
      config.twilioFromNumber = twilioFromNumber;
      config.smsEnabled = input.smsEnabled;
    }

    await this.configRepo.save(config);
    logger.info("Email configuration updated");

    return config;
  }

  async sendInvitationEmail(
    params: SendInvitationEmailParams,
  ): Promise<void> {
    const config = await this.getConfig();

    if (!config) {
      throw new AppError(
        500,
        "Email configuration not found. Please configure email settings first.",
        "EMAIL_NOT_CONFIGURED",
      );
    }

    if (!config.enabled) {
      logger.warn(
        { to: params.to },
        "Email sending is disabled, skipping invitation email",
      );
      return;
    }

    const resend = new Resend(config.resendApiKey);

    try {
      const { data, error } = await resend.emails.send({
        from: `${config.fromName} <${config.fromEmail}>`,
        to: params.to,
        subject: "You've been invited to join",
        html: this.buildInvitationEmailHtml(params),
      });

      if (error) {
        logger.error({ error, to: params.to }, "Failed to send invitation email");
        throw new AppError(
          500,
          "Failed to send invitation email",
          "EMAIL_SEND_FAILED",
          { error },
        );
      }

      logger.info({ to: params.to, emailId: data?.id }, "Invitation email sent");
    } catch (err) {
      logger.error({ err, to: params.to }, "Error sending invitation email");
      throw new AppError(
        500,
        "Error sending invitation email",
        "EMAIL_SEND_ERROR",
        { error: err },
      );
    }
  }

  async sendSecurityCodeEmail(
    params: SendSecurityCodeEmailParams,
  ): Promise<void> {
    const config = await this.getConfig();

    if (!config) {
      throw new AppError(
        500,
        "Email configuration not found. Please configure email settings first.",
        "EMAIL_NOT_CONFIGURED",
      );
    }

    if (!config.enabled) {
      throw new AppError(
        500,
        "Email sending is disabled. Cannot send security code.",
        "EMAIL_DISABLED",
      );
    }

    const resend = new Resend(config.resendApiKey);

    const { data, error } = await resend.emails.send({
      from: `${config.fromName} <${config.fromEmail}>`,
      to: params.to,
      subject: "Your security code",
      html: this.buildSecurityCodeEmailHtml(params),
    });

    if (error) {
      logger.error({ error, to: params.to }, "Failed to send security code email");
      throw new AppError(
        500,
        "Failed to send security code email",
        "EMAIL_SEND_FAILED",
        { error },
      );
    }

    logger.info({ to: params.to, emailId: data?.id }, "Security code email sent");
  }

  async sendSecurityCodeSms(
    params: SendSecurityCodeSmsParams,
  ): Promise<void> {
    const config = await this.getConfig();

    if (!config?.twilioAccountSid || !config.twilioAuthToken || !config.twilioFromNumber) {
      throw new AppError(
        500,
        "SMS configuration not found. Please configure Twilio settings first.",
        "SMS_NOT_CONFIGURED",
      );
    }

    if (!config.smsEnabled) {
      throw new AppError(
        500,
        "SMS sending is disabled. Cannot send security code.",
        "SMS_DISABLED",
      );
    }

    const client = twilio(config.twilioAccountSid, config.twilioAuthToken);

    try {
      const message = await client.messages.create({
        body: `Your Enhance Education security code is ${params.code}. It expires in 10 minutes.`,
        from: config.twilioFromNumber,
        to: params.to,
      });

      logger.info(
        { to: params.to, sid: message.sid },
        "Security code SMS sent",
      );
    } catch (error) {
      logger.error({ error, to: params.to }, "Failed to send security code SMS");
      throw new AppError(
        500,
        "Failed to send security code SMS",
        "SMS_SEND_FAILED",
        { error },
      );
    }
  }

  private buildSecurityCodeEmailHtml(
    params: SendSecurityCodeEmailParams,
  ): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your security code</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background-color: #f7f7f7; padding: 30px; border-radius: 8px;">
    <h1 style="color: #2c3e50; margin-bottom: 20px;">Your security code</h1>
    <p>Hi ${params.fullName},</p>
    <p>Enter this code to finish setting up your account:</p>
    <p style="font-size: 32px; font-weight: 700; letter-spacing: 0.25em; text-align: center; margin: 24px 0; color: #002117;">${params.code}</p>
    <p style="color: #7f8c8d; font-size: 14px;">This code expires in 10 minutes. If you did not request it, you can ignore this email.</p>
  </div>
</body>
</html>
    `.trim();
  }

  private buildInvitationEmailHtml(params: SendInvitationEmailParams): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You've been invited</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background-color: #f7f7f7; padding: 30px; border-radius: 8px;">
    <h1 style="color: #2c3e50; margin-bottom: 20px;">You've been invited</h1>
    
    <p>Hi ${params.fullName},</p>
    
    <p>You've been invited to join our platform. Click the button below to accept your invitation and set up your account.</p>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="${params.invitationLink}" 
         style="background-color: #3498db; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: 600;">
        Accept Invitation
      </a>
    </div>
    
    <p style="color: #7f8c8d; font-size: 14px;">
      This invitation link expires in 48 hours. If you didn't expect this invitation, you can safely ignore this email.
    </p>
    
    <p style="color: #7f8c8d; font-size: 14px; margin-top: 20px;">
      If the button doesn't work, copy and paste this link into your browser:<br>
      <a href="${params.invitationLink}" style="color: #3498db; word-break: break-all;">${params.invitationLink}</a>
    </p>
  </div>
</body>
</html>
    `.trim();
  }
}

export const emailService = new EmailService();
