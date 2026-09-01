import { Resend } from "resend";
import twilio from "twilio";
import { AppDataSource } from "../../config/data-source.js";
import { logger } from "../../config/logger.js";
import { AppError } from "../../common/errors/AppError.js";
import { MessagingConfig } from "../../entities/EmailConfig.js";

export interface InvitationEnrollmentDetails {
  studentFullName: string;
  studentPreferredName?: string | null;
  yearLevel?: number | null;
  termName: string;
  termStartDate: string;
  termEndDate: string;
  subjects: string[];
  fee: number;
  isTrial?: boolean;
}

export interface SendInvitationEmailParams {
  to: string;
  fullName: string;
  invitationLink: string;
  roleLabel?: string;
  enrollments?: InvitationEnrollmentDetails[];
  attachments?: EmailAttachment[];
}

export type EmailAttachment = {
  filename: string;
  content: Buffer;
};

export interface SendTrialBookingEmailParams {
  to: string;
  fullName: string;
  actionLink: string;
  actionLabel: string;
  isNewAccount: boolean;
  enrollments: InvitationEnrollmentDetails[];
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

export interface SendEnrollmentChangeEmailParams {
  to: string;
  fullName: string;
  studentFullName: string;
  reviewLink: string;
}

export interface SendAbsenceAlertEmailParams {
  to: string;
  guardianName: string;
  studentFullName: string;
  sessionName: string;
  sessionWhen: string;
  message: string;
}
export interface SendNewEnrollmentEmailParams {
  to: string;
  fullName: string;
  studentFullName: string;
  reviewLink: string;
  attachments?: EmailAttachment[];
}

export interface SendPasswordResetEmailParams {
  to: string;
  fullName: string;
  resetLink: string;
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
      throw new AppError(
        500,
        "Email sending is disabled. Enable it in System Settings → Message history, then try again.",
        "EMAIL_DISABLED",
      );
    }

    const resend = new Resend(config.resendApiKey);

    try {
      const { data, error } = await resend.emails.send({
        from: `${config.fromName} <${config.fromEmail}>`,
        to: params.to,
        subject: params.enrollments?.length
          ? params.enrollments.some((row) => row.isTrial)
            ? `Trial booking for ${params.enrollments[0].studentFullName}`
            : `Enrolment invitation for ${params.enrollments[0].studentFullName}`
          : "You've been invited to join",
        html: this.buildInvitationEmailHtml(params),
        attachments: this.toResendAttachments(params.attachments),
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

  async sendTrialBookingEmail(
    params: SendTrialBookingEmailParams,
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
        "Email sending is disabled. Enable it in System Settings → Message history, then try again.",
        "EMAIL_DISABLED",
      );
    }

    const resend = new Resend(config.resendApiKey);
    const student = params.enrollments[0]?.studentFullName ?? "your student";

    try {
      const { data, error } = await resend.emails.send({
        from: `${config.fromName} <${config.fromEmail}>`,
        to: params.to,
        subject: `Trial place confirmed for ${student}`,
        html: this.buildTrialBookingEmailHtml(params),
      });

      if (error) {
        logger.error({ error, to: params.to }, "Failed to send trial booking email");
        throw new AppError(
          500,
          "Failed to send trial booking email",
          "EMAIL_SEND_FAILED",
          { error },
        );
      }

      logger.info({ to: params.to, emailId: data?.id }, "Trial booking email sent");
    } catch (err) {
      if (err instanceof AppError) throw err;
      logger.error({ err, to: params.to }, "Error sending trial booking email");
      throw new AppError(
        500,
        "Error sending trial booking email",
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

  async sendPasswordResetEmail(
    params: SendPasswordResetEmailParams,
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
        "Email sending is disabled, skipping password reset email",
      );
      return;
    }

    const resend = new Resend(config.resendApiKey);

    try {
      const { data, error } = await resend.emails.send({
        from: `${config.fromName} <${config.fromEmail}>`,
        to: params.to,
        subject: "Reset your password",
        html: this.buildPasswordResetEmailHtml(params),
      });

      if (error) {
        logger.error(
          { error, to: params.to },
          "Failed to send password reset email",
        );
        throw new AppError(
          500,
          "Failed to send password reset email",
          "EMAIL_SEND_FAILED",
          { error },
        );
      }

      logger.info(
        { to: params.to, emailId: data?.id },
        "Password reset email sent",
      );
    } catch (err) {
      if (err instanceof AppError) throw err;
      logger.error({ err, to: params.to }, "Error sending password reset email");
      throw new AppError(
        500,
        "Error sending password reset email",
        "EMAIL_SEND_ERROR",
        { error: err },
      );
    }
  }

  async sendAbsenceAlertEmail(
    params: SendAbsenceAlertEmailParams,
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
        "Email sending is disabled, skipping absence alert email",
      );
      return;
    }

    const resend = new Resend(config.resendApiKey);
    const bodyHtml = escapeHtml(params.message).replace(/\n/g, "<br />");

    try {
      const { data, error } = await resend.emails.send({
        from: `${config.fromName} <${config.fromEmail}>`,
        to: params.to,
        subject: `Absence notice — ${params.studentFullName}`,
        html: `
<!DOCTYPE html>
<html lang="en">
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background-color: #f7f7f7; padding: 30px; border-radius: 8px;">
    <h1 style="color: #002c23; margin-bottom: 16px;">Absence notice</h1>
    <p>Hi ${escapeHtml(params.guardianName)},</p>
    <p>${bodyHtml}</p>
    <p style="color: #7f8c8d; font-size: 14px; margin-top: 24px;">${escapeHtml(params.sessionName)} · ${escapeHtml(params.sessionWhen)}</p>
  </div>
</body>
</html>`.trim(),
      });

      if (error) {
        logger.error(
          { error, to: params.to },
          "Failed to send absence alert email",
        );
        throw new AppError(
          500,
          "Failed to send absence alert email",
          "EMAIL_SEND_FAILED",
          { error },
        );
      }

      logger.info(
        { to: params.to, emailId: data?.id },
        "Absence alert email sent",
      );
    } catch (err) {
      if (err instanceof AppError) throw err;
      logger.error({ err, to: params.to }, "Error sending absence alert email");
      throw new AppError(
        500,
        "Error sending absence alert email",
        "EMAIL_SEND_ERROR",
        { error: err },
      );
    }
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

  private buildPasswordResetEmailHtml(
    params: SendPasswordResetEmailParams,
  ): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset your password</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background-color: #f7f7f7; padding: 30px; border-radius: 8px;">
    <h1 style="color: #2c3e50; margin-bottom: 20px;">Reset your password</h1>
    <p>Hi ${params.fullName},</p>
    <p>We received a request to reset the password for your Enhance Education account. Click the button below to choose a new password.</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${params.resetLink}"
         style="background-color: #e18f33; color: #002117; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: 700;">
        Set a new password
      </a>
    </div>
    <p style="color: #7f8c8d; font-size: 14px;">
      This link expires in one hour and can only be used once. If you did not ask for a reset, you can ignore this email.
    </p>
    <p style="color: #7f8c8d; font-size: 14px; margin-top: 20px;">
      If the button doesn't work, copy and paste this link into your browser:<br>
      <a href="${params.resetLink}" style="color: #e18f33; word-break: break-all;">${params.resetLink}</a>
    </p>
  </div>
</body>
</html>
    `.trim();
  }

  async sendEnrollmentChangeEmail(
    params: SendEnrollmentChangeEmailParams,
  ): Promise<void> {
    const config = await this.getConfig();
    if (!config || !config.enabled) {
      logger.warn(
        { to: params.to },
        "Email sending is disabled, skipping enrolment change email",
      );
      return;
    }

    const resend = new Resend(config.resendApiKey);
    const { error } = await resend.emails.send({
      from: `${config.fromName} <${config.fromEmail}>`,
      to: params.to,
      subject: `Enrolment change for ${params.studentFullName}`,
      html: `
<!DOCTYPE html>
<html lang="en">
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background-color: #f7f7f7; padding: 30px; border-radius: 8px;">
    <h1 style="color: #2c3e50;">Enrolment change to review</h1>
    <p>Hi ${escapeHtml(params.fullName)},</p>
    <p>The school has updated the enrolment for <strong>${escapeHtml(params.studentFullName)}</strong>. Please sign in to review the previous and new details, then accept the change.</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${params.reviewLink}"
         style="background-color: #e18f33; color: #002117; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: 700;">
        Review enrolment
      </a>
    </div>
  </div>
</body>
</html>`.trim(),
    });

    if (error) {
      logger.warn({ error, to: params.to }, "Failed to send enrolment change email");
    }
  }

  async sendNewEnrollmentEmail(
    params: SendNewEnrollmentEmailParams,
  ): Promise<void> {
    const config = await this.getConfig();
    if (!config || !config.enabled) {
      logger.warn(
        { to: params.to },
        "Email sending is disabled, skipping new enrolment email",
      );
      return;
    }

    const resend = new Resend(config.resendApiKey);
    const { error } = await resend.emails.send({
      from: `${config.fromName} <${config.fromEmail}>`,
      to: params.to,
      subject: `New enrolment for ${params.studentFullName}`,
      html: `
<!DOCTYPE html>
<html lang="en">
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background-color: #f7f7f7; padding: 30px; border-radius: 8px;">
    <h1 style="color: #2c3e50;">New enrolment to accept</h1>
    <p>Hi ${escapeHtml(params.fullName)},</p>
    <p>The school has enrolled <strong>${escapeHtml(params.studentFullName)}</strong>. Please sign in to review the details, set their student login, and accept the enrolment.${params.attachments?.length ? " A timetable PDF for the selected subjects is attached." : ""}</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${params.reviewLink}"
         style="background-color: #e18f33; color: #002117; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: 700;">
        Review enrolment
      </a>
    </div>
  </div>
</body>
</html>`.trim(),
      attachments: this.toResendAttachments(params.attachments),
    });

    if (error) {
      logger.warn({ error, to: params.to }, "Failed to send new enrolment email");
    }
  }

  private toResendAttachments(attachments?: EmailAttachment[]) {
    if (!attachments?.length) return undefined;
    return attachments.map((attachment) => ({
      filename: attachment.filename,
      content: attachment.content,
    }));
  }

  private buildInvitationEmailHtml(params: SendInvitationEmailParams): string {
    const enrollmentsHtml = this.buildEnrollmentDetailsHtml(params.enrollments);
    const greetingName = escapeHtml(params.fullName);
    const enrollmentCount = params.enrollments?.length ?? 0;
    const trial = Boolean(params.enrollments?.some((row) => row.isTrial));
    const timetableNote = params.attachments?.length
      ? " Timetable PDFs for the selected subjects are attached to this email."
      : "";
    const intro =
      enrollmentCount === 0
        ? "You've been invited to join Enhance Education. Click the button below to accept your invitation and set up your account."
        : enrollmentCount === 1
          ? trial
            ? "A trial place has been booked. Review the details below, then create your guardian account and a trial login for your student."
            : "You've been invited as a guardian. Please review the enrolment details below, then accept the invitation to set up your account and your student's login."
          : trial
            ? `${enrollmentCount} trial places have been booked. Review each student's details below, then create your guardian account and a trial login for each student.`
            : `You've been invited as a guardian. Please review the enrolment details for each of the ${enrollmentCount} students below, then accept the invitation to set up your account and their logins.`;

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${trial ? "Trial place confirmed" : "You've been invited"}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background-color: #f7f7f7; padding: 30px; border-radius: 8px;">
    <h1 style="color: #002117; margin-bottom: 20px;">${trial ? "Your trial place is booked" : "You've been invited"}</h1>
    
    <p>Hi ${greetingName},</p>
    
    <p>${intro}${timetableNote}</p>
    ${enrollmentsHtml}
    <div style="text-align: center; margin: 30px 0;">
      <a href="${params.invitationLink}" 
         style="background-color: #e18f33; color: #002117; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: 700;">
        ${trial ? "Create trial accounts" : "Accept invitation"}
      </a>
    </div>
    
    <p style="color: #7f8c8d; font-size: 14px;">
      This invitation link expires in 48 hours. If you didn't expect this invitation, you can safely ignore this email.
    </p>
    
    <p style="color: #7f8c8d; font-size: 14px; margin-top: 20px;">
      If the button doesn't work, copy and paste this link into your browser:<br>
      <a href="${params.invitationLink}" style="color: #e18f33; word-break: break-all;">${params.invitationLink}</a>
    </p>
  </div>
</body>
</html>
    `.trim();
  }

  private buildEnrollmentDetailsHtml(
    enrollments?: InvitationEnrollmentDetails[],
  ): string {
    if (!enrollments?.length) return "";

    const cards = enrollments
      .map((enrollment) => {
        const preferred = enrollment.studentPreferredName
          ? ` (${escapeHtml(enrollment.studentPreferredName)})`
          : "";
        const yearLevel = enrollment.yearLevel
          ? `<tr><td style="padding: 6px 0; color: #5c6b66;">Year level</td><td style="padding: 6px 0; font-weight: 600;">Year ${enrollment.yearLevel}</td></tr>`
          : "";
        const subjects = enrollment.subjects.length
          ? escapeHtml(enrollment.subjects.join(", "))
          : "—";
        const fee = formatAud(enrollment.fee);
        const dates = `${formatMailDate(enrollment.termStartDate)} – ${formatMailDate(enrollment.termEndDate)}`;

        return `
        <div style="background: #ffffff; border: 1px solid #e6e0d8; border-radius: 8px; padding: 16px 18px; margin: 16px 0;">
          <p style="margin: 0 0 10px; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #e18f33; font-weight: 700;">${enrollment.isTrial ? "Trial booking" : "Enrolment"}</p>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
              <td style="padding: 6px 0; color: #5c6b66; width: 38%;">Student</td>
              <td style="padding: 6px 0; font-weight: 600;">${escapeHtml(enrollment.studentFullName)}${preferred}</td>
            </tr>
            ${yearLevel}
            <tr>
              <td style="padding: 6px 0; color: #5c6b66;">Term</td>
              <td style="padding: 6px 0; font-weight: 600;">${escapeHtml(enrollment.termName)}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #5c6b66;">Dates</td>
              <td style="padding: 6px 0;">${dates}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #5c6b66;">Subjects</td>
              <td style="padding: 6px 0;">${subjects}</td>
            </tr>
            ${
              enrollment.isTrial
                ? ""
                : `<tr>
              <td style="padding: 6px 0; color: #5c6b66;">Fee</td>
              <td style="padding: 6px 0; font-weight: 700;">${fee}</td>
            </tr>`
            }
          </table>
        </div>`;
      })
      .join("");

    return `
      <p style="margin: 20px 0 8px; font-weight: 700;">${enrollments.some((row) => row.isTrial) ? "Trial details" : "Enrolment details"}</p>
      ${cards}
      <p style="font-size: 14px; color: #5c6b66;">When you accept, you will set a unique username and password for each student.</p>
    `;
  }

  private buildTrialBookingEmailHtml(params: SendTrialBookingEmailParams): string {
    const enrollmentsHtml = this.buildEnrollmentDetailsHtml(
      params.enrollments.map((row) => ({ ...row, isTrial: true })),
    );
    const intro = params.isNewAccount
      ? "We've reserved a trial place. Create your guardian account and a trial login for your student using the button below."
      : "We've reserved a trial place. Sign in to accept it and set your student's trial login.";

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trial place confirmed</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background-color: #f7f7f7; padding: 30px; border-radius: 8px;">
    <h1 style="color: #002117; margin-bottom: 20px;">Your trial place is booked</h1>
    <p>Hi ${escapeHtml(params.fullName)},</p>
    <p>${intro}</p>
    ${enrollmentsHtml}
    <div style="text-align: center; margin: 30px 0;">
      <a href="${params.actionLink}"
         style="background-color: #e18f33; color: #002117; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: 700;">
        ${escapeHtml(params.actionLabel)}
      </a>
    </div>
    <p style="color: #7f8c8d; font-size: 14px;">
      If the button doesn't work, copy and paste this link into your browser:<br>
      <a href="${params.actionLink}" style="color: #e18f33; word-break: break-all;">${params.actionLink}</a>
    </p>
  </div>
</body>
</html>`.trim();
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatAud(value: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(value);
}

function formatMailDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export const emailService = new EmailService();
