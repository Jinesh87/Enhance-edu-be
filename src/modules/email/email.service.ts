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

export interface SendHomeworkOverdueEmailParams {
  to: string;
  guardianName: string;
  studentFullName: string;
  homeworkTitle: string;
  subjectName: string;
  dueDate: string;
}

export interface SendEnquiryCapturedEmailParams {
  to: string;
  staffName: string;
  studentName: string;
  guardianName: string;
  subjectOfInterest: string;
  enquiryLink: string;
}

export interface SendTrialConfirmedEmailParams {
  to: string;
  fullName: string;
  studentName: string;
  classLabel: string;
  portalLink: string;
}

export interface SendEnrollmentAcceptedEmailParams {
  to: string;
  fullName: string;
  studentName: string;
  portalLink: string;
  isStudent: boolean;
}

export interface SendHolidayReminderEmailParams {
  to: string;
  fullName: string;
  holidayName: string;
  dateLabel: string;
  leadDays: 7 | 2;
}

export interface SendAnnouncementEmailParams {
  to: string;
  fullName: string;
  title: string;
  message: string;
  emergency?: boolean;
}

export interface SendSessionChangeEmailParams {
  to: string;
  fullName: string;
  title: string;
  body: string;
  sessionWhen: string;
  classLabel: string;
}

export interface SendClassDigestEmailParams {
  to: string;
  fullName: string;
  digestDateLabel: string;
  sessions: Array<{
    label: string;
    when: string;
    room: string;
  }>;
}

export interface SendTermScheduleEmailParams {
  to: string;
  fullName: string;
  termLabel: string;
  termDateRange: string;
  sessions: Array<{
    label: string;
    when: string;
    room: string;
  }>;
  truncatedCount?: number;
  attachments?: EmailAttachment[];
  actionLink?: string;
}

export interface SendSessionChangeSmsParams {
  to: string;
  body: string;
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

export interface SendAdminCommunicationEmailParams {
  to: string;
  fullName: string;
  subject: string;
  bodyText: string;
  attachments?: EmailAttachment[];
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

    const html = buildResponsiveEmailShell({
      previewText: `Absence notice for ${params.studentFullName}`,
      badgeText: "Absence Notice",
      badgeTone: "amber",
      title: "Student Absence Notice",
      recipientName: params.guardianName,
      introHtml: `<p style="margin:0;">${bodyHtml}</p>`,
      detailsCardHtml: `
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr>
            <td style="padding: 6px 0; color: #64748B; width: 32%;">Student</td>
            <td style="padding: 6px 0; font-weight: 700; color: #002C23;">${escapeHtml(params.studentFullName)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748B;">Class Session</td>
            <td style="padding: 6px 0; font-weight: 600; color: #002C23;">${escapeHtml(params.sessionName)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748B;">Date & Time</td>
            <td style="padding: 6px 0; color: #334155;">${escapeHtml(params.sessionWhen)}</td>
          </tr>
        </table>
      `,
      secondaryNotice: "If this absence is recorded in error or you have already notified the centre, no further action is required.",
    });

    try {
      const { data, error } = await resend.emails.send({
        from: `${config.fromName} <${config.fromEmail}>`,
        to: params.to,
        subject: `Absence notice — ${params.studentFullName}`,
        html,
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

  async sendHomeworkOverdueEmail(
    params: SendHomeworkOverdueEmailParams,
  ): Promise<void> {
    const config = await this.getConfig();

    if (!config) {
      logger.warn(
        { to: params.to },
        "Email configuration not found, skipping homework overdue email",
      );
      return;
    }

    if (!config.enabled) {
      logger.warn(
        { to: params.to },
        "Email sending is disabled, skipping homework overdue email",
      );
      return;
    }

    const resend = new Resend(config.resendApiKey);

    const html = buildResponsiveEmailShell({
      previewText: `Overdue homework for ${params.studentFullName}: ${params.homeworkTitle}`,
      badgeText: "Homework Reminder",
      badgeTone: "amber",
      title: "Homework Task Overdue",
      recipientName: params.guardianName,
      introHtml: `<p style="margin:0;">This is a reminder that a homework assignment for <strong>${escapeHtml(params.studentFullName)}</strong> has passed its scheduled due date.</p>`,
      detailsCardHtml: `
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr>
            <td style="padding: 6px 0; color: #64748B; width: 32%;">Student</td>
            <td style="padding: 6px 0; font-weight: 700; color: #002C23;">${escapeHtml(params.studentFullName)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748B;">Task</td>
            <td style="padding: 6px 0; font-weight: 600; color: #002C23;">${escapeHtml(params.homeworkTitle)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748B;">Subject</td>
            <td style="padding: 6px 0; color: #334155;">${escapeHtml(params.subjectName)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748B;">Due Date</td>
            <td style="padding: 6px 0; font-weight: 600; color: #991B1B;">${escapeHtml(params.dueDate)}</td>
          </tr>
        </table>
      `,
      secondaryNotice: "Please sign in to the portal to view submission instructions or contact your tutor if assistance is needed.",
    });

    try {
      const { data, error } = await resend.emails.send({
        from: `${config.fromName} <${config.fromEmail}>`,
        to: params.to,
        subject: `Homework overdue — ${params.studentFullName}`,
        html,
      });

      if (error) {
        logger.error(
          { error, to: params.to },
          "Failed to send homework overdue email",
        );
        throw new AppError(
          500,
          "Failed to send homework overdue email",
          "EMAIL_SEND_FAILED",
          { error },
        );
      }

      logger.info(
        { to: params.to, emailId: data?.id },
        "Homework overdue email sent",
      );
    } catch (err) {
      if (err instanceof AppError) throw err;
      logger.error({ err, to: params.to }, "Error sending homework overdue email");
      throw new AppError(
        500,
        "Error sending homework overdue email",
        "EMAIL_SEND_ERROR",
        { error: err },
      );
    }
  }

  async sendEnquiryCapturedEmail(
    params: SendEnquiryCapturedEmailParams,
  ): Promise<void> {
    const config = await this.getConfig();
    if (!config?.enabled) {
      logger.warn(
        { to: params.to },
        "Email disabled/missing, skipping enquiry captured email",
      );
      return;
    }

    const resend = new Resend(config.resendApiKey);

    const html = buildResponsiveEmailShell({
      previewText: `New enquiry captured for ${params.studentName}`,
      badgeText: "Lead Captured",
      badgeTone: "info",
      title: "New Student Enquiry",
      recipientName: params.staffName,
      introHtml: `<p style="margin:0;">A new enrolment enquiry has been received and requires staff review.</p>`,
      detailsCardHtml: `
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr>
            <td style="padding: 6px 0; color: #64748B; width: 36%;">Student</td>
            <td style="padding: 6px 0; font-weight: 700; color: #002C23;">${escapeHtml(params.studentName)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748B;">Guardian</td>
            <td style="padding: 6px 0; font-weight: 600; color: #002C23;">${escapeHtml(params.guardianName)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748B;">Subject of Interest</td>
            <td style="padding: 6px 0; color: #334155;">${escapeHtml(params.subjectOfInterest)}</td>
          </tr>
        </table>
      `,
      cta: {
        label: "Open Enquiry Record",
        url: params.enquiryLink,
      },
    });

    try {
      const { data, error } = await resend.emails.send({
        from: `${config.fromName} <${config.fromEmail}>`,
        to: params.to,
        subject: `New enquiry — ${params.studentName}`,
        html,
      });
      if (error) {
        logger.error({ error, to: params.to }, "Failed to send enquiry email");
        return;
      }
      logger.info(
        { to: params.to, emailId: data?.id },
        "Enquiry captured email sent",
      );
    } catch (err) {
      logger.error({ err, to: params.to }, "Error sending enquiry email");
    }
  }

  async sendTrialConfirmedEmail(
    params: SendTrialConfirmedEmailParams,
  ): Promise<void> {
    const config = await this.getConfig();
    if (!config?.enabled) {
      logger.warn(
        { to: params.to },
        "Email disabled/missing, skipping trial confirmed email",
      );
      return;
    }

    const resend = new Resend(config.resendApiKey);

    const html = buildResponsiveEmailShell({
      previewText: `Trial session confirmed for ${params.studentName}`,
      badgeText: "Booking Confirmed",
      badgeTone: "success",
      title: "Trial Lesson Confirmed",
      recipientName: params.fullName,
      introHtml: `<p style="margin:0;">The trial class booking for <strong>${escapeHtml(params.studentName)}</strong> has been confirmed. You can view all schedule details in your portal.</p>`,
      detailsCardHtml: `
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr>
            <td style="padding: 6px 0; color: #64748B; width: 32%;">Student</td>
            <td style="padding: 6px 0; font-weight: 700; color: #002C23;">${escapeHtml(params.studentName)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748B;">Class / Program</td>
            <td style="padding: 6px 0; font-weight: 600; color: #002C23;">${escapeHtml(params.classLabel)}</td>
          </tr>
        </table>
      `,
      cta: {
        label: "Access Portal",
        url: params.portalLink,
      },
    });

    try {
      const { data, error } = await resend.emails.send({
        from: `${config.fromName} <${config.fromEmail}>`,
        to: params.to,
        subject: `Trial confirmed — ${params.studentName}`,
        html,
      });
      if (error) {
        logger.error(
          { error, to: params.to },
          "Failed to send trial confirmed email",
        );
        return;
      }
      logger.info(
        { to: params.to, emailId: data?.id },
        "Trial confirmed email sent",
      );
    } catch (err) {
      logger.error({ err, to: params.to }, "Error sending trial confirmed email");
    }
  }

  async sendEnrollmentAcceptedEmail(
    params: SendEnrollmentAcceptedEmailParams,
  ): Promise<void> {
    const config = await this.getConfig();
    if (!config?.enabled) {
      logger.warn(
        { to: params.to },
        "Email disabled/missing, skipping enrolment accepted email",
      );
      return;
    }

    const resend = new Resend(config.resendApiKey);
    const heading = params.isStudent
      ? "Welcome! You're Enrolled"
      : "Enrolment Confirmed";
    const body = params.isStudent
      ? `Your enrolment for <strong>${escapeHtml(params.studentName)}</strong> is fully confirmed. Sign in to your student portal to access your classes, resources, and timetable.`
      : `Enrolment for <strong>${escapeHtml(params.studentName)}</strong> is fully confirmed. You can view all active classes, timetables, and invoices in your guardian portal.`;

    const html = buildResponsiveEmailShell({
      previewText: `Enrolment confirmed for ${params.studentName}`,
      badgeText: "Enrolment Active",
      badgeTone: "success",
      title: heading,
      recipientName: params.fullName,
      introHtml: `<p style="margin:0;">${body}</p>`,
      cta: {
        label: "Go to Portal",
        url: params.portalLink,
      },
    });

    try {
      const { data, error } = await resend.emails.send({
        from: `${config.fromName} <${config.fromEmail}>`,
        to: params.to,
        subject: params.isStudent
          ? "You're enrolled — Enhance Education"
          : `Enrolment confirmed — ${params.studentName}`,
        html,
      });
      if (error) {
        logger.error(
          { error, to: params.to },
          "Failed to send enrolment accepted email",
        );
        return;
      }
      logger.info(
        { to: params.to, emailId: data?.id },
        "Enrolment accepted email sent",
      );
    } catch (err) {
      logger.error(
        { err, to: params.to },
        "Error sending enrolment accepted email",
      );
    }
  }

  async sendHolidayReminderEmail(
    params: SendHolidayReminderEmailParams,
  ): Promise<void> {
    const config = await this.getConfig();
    if (!config?.enabled) {
      logger.warn(
        { to: params.to },
        "Email disabled/missing, skipping holiday reminder email",
      );
      return;
    }

    const when =
      params.leadDays === 7 ? "in one week" : "in two days";
    const resend = new Resend(config.resendApiKey);

    const html = buildResponsiveEmailShell({
      previewText: `Centre closure notice: ${params.holidayName} is ${when}`,
      badgeText: "Centre Closure",
      badgeTone: "amber",
      title: "Public Holiday & Centre Notice",
      recipientName: params.fullName,
      introHtml: `<p style="margin:0;">Please note that Enhance Education will be closed for <strong>${escapeHtml(params.holidayName)}</strong> ${escapeHtml(when)}.</p>`,
      detailsCardHtml: `
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr>
            <td style="padding: 6px 0; color: #64748B; width: 32%;">Holiday / Event</td>
            <td style="padding: 6px 0; font-weight: 700; color: #002C23;">${escapeHtml(params.holidayName)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748B;">Date</td>
            <td style="padding: 6px 0; font-weight: 600; color: #002C23;">${escapeHtml(params.dateLabel)}</td>
          </tr>
        </table>
      `,
      secondaryNotice: "Regularly scheduled classes that fall on this day will not run. Please check your student portal for your updated timetable.",
    });

    try {
      const { data, error } = await resend.emails.send({
        from: `${config.fromName} <${config.fromEmail}>`,
        to: params.to,
        subject: `${params.holidayName} — ${when}`,
        html,
      });
      if (error) {
        logger.error(
          { error, to: params.to },
          "Failed to send holiday reminder email",
        );
        return;
      }
      logger.info(
        { to: params.to, emailId: data?.id },
        "Holiday reminder email sent",
      );
    } catch (err) {
      logger.error({ err, to: params.to }, "Error sending holiday reminder email");
    }
  }

  async sendAnnouncementEmail(
    params: SendAnnouncementEmailParams,
  ): Promise<void> {
    const config = await this.getConfig();
    if (!config?.enabled) {
      logger.warn(
        { to: params.to },
        "Email disabled/missing, skipping announcement email",
      );
      return;
    }

    const heading = params.emergency ? "Emergency Alert" : "Important Announcement";
    const subjectPrefix = params.emergency ? "EMERGENCY: " : "";
    const resend = new Resend(config.resendApiKey);

    const html = buildResponsiveEmailShell({
      previewText: params.title,
      badgeText: params.emergency ? "Urgent Notice" : "Announcement",
      badgeTone: params.emergency ? "emergency" : "default",
      title: heading,
      recipientName: params.fullName,
      introHtml: `<h3 style="margin: 0 0 12px; font-size: 16px; font-weight: 700; color: ${params.emergency ? "#991B1B" : "#002C23"};">${escapeHtml(params.title)}</h3><div style="font-size: 14px; line-height: 1.6; color: #334155; white-space: pre-wrap;">${escapeHtml(params.message)}</div>`,
    });

    try {
      const { data, error } = await resend.emails.send({
        from: `${config.fromName} <${config.fromEmail}>`,
        to: params.to,
        subject: `${subjectPrefix}${params.title}`.slice(0, 200),
        html,
      });
      if (error) {
        logger.error(
          { error, to: params.to },
          "Failed to send announcement email",
        );
        return;
      }
      logger.info(
        { to: params.to, emailId: data?.id, emergency: Boolean(params.emergency) },
        "Announcement email sent",
      );
    } catch (err) {
      logger.error({ err, to: params.to }, "Error sending announcement email");
    }
  }

  async sendSessionChangeEmail(
    params: SendSessionChangeEmailParams,
  ): Promise<void> {
    const config = await this.getConfig();

    if (!config) {
      logger.warn(
        { to: params.to },
        "Email configuration not found, skipping session change email",
      );
      return;
    }

    if (!config.enabled) {
      logger.warn(
        { to: params.to },
        "Email sending is disabled, skipping session change email",
      );
      return;
    }

    const resend = new Resend(config.resendApiKey);

    const html = buildResponsiveEmailShell({
      previewText: params.title,
      badgeText: "Schedule Update",
      badgeTone: "amber",
      title: params.title,
      recipientName: params.fullName,
      introHtml: `<p style="margin:0;">${escapeHtml(params.body)}</p>`,
      detailsCardHtml: `
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr>
            <td style="padding: 6px 0; color: #64748B; width: 32%;">Class</td>
            <td style="padding: 6px 0; font-weight: 700; color: #002C23;">${escapeHtml(params.classLabel)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748B;">Date & Time</td>
            <td style="padding: 6px 0; font-weight: 600; color: #002C23;">${escapeHtml(params.sessionWhen)}</td>
          </tr>
        </table>
      `,
      secondaryNotice: "Please check your portal timetable for updated classroom and attendance records.",
    });

    try {
      const { data, error } = await resend.emails.send({
        from: `${config.fromName} <${config.fromEmail}>`,
        to: params.to,
        subject: params.title,
        html,
      });

      if (error) {
        logger.error(
          { error, to: params.to },
          "Failed to send session change email",
        );
        return;
      }

      logger.info(
        { to: params.to, emailId: data?.id },
        "Session change email sent",
      );
    } catch (err) {
      logger.error({ err, to: params.to }, "Error sending session change email");
    }
  }

  async sendClassDigestEmail(params: SendClassDigestEmailParams): Promise<void> {
    const config = await this.getConfig();
    if (!config?.enabled) {
      logger.warn(
        { to: params.to },
        "Email disabled or missing, skipping class digest email",
      );
      return;
    }

    const rows = params.sessions
      .map(
        (session) => `
        <div style="background: #FFFFFF; border: 1px solid #ECE5DB; border-radius: 6px; padding: 12px 14px; margin-bottom: 8px;">
          <div style="font-weight: 700; color: #002C23; font-size: 14px;">${escapeHtml(session.label)}</div>
          <div style="font-size: 13px; color: #64748B; margin-top: 2px;">
            <span>🕒 ${escapeHtml(session.when)}</span> &nbsp;·&nbsp; <span>📍 Room ${escapeHtml(session.room)}</span>
          </div>
        </div>`,
      )
      .join("");

    const html = buildResponsiveEmailShell({
      previewText: `Upcoming classes for ${params.digestDateLabel}`,
      badgeText: "Daily Digest",
      badgeTone: "default",
      title: "Tomorrow's Classes",
      recipientName: params.fullName,
      introHtml: `<p style="margin:0;">Here is your schedule overview for <strong>${escapeHtml(params.digestDateLabel)}</strong>:</p>`,
      detailsCardHtml: rows || `<p style="margin:0;color:#64748B;font-size:14px;">No sessions scheduled.</p>`,
      secondaryNotice: "Please ensure all learning materials and pre-work are prepared prior to class start.",
    });

    const resend = new Resend(config.resendApiKey);
    try {
      const { data, error } = await resend.emails.send({
        from: `${config.fromName} <${config.fromEmail}>`,
        to: params.to,
        subject: `Tomorrow's classes · ${params.digestDateLabel}`,
        html,
      });

      if (error) {
        logger.error({ error, to: params.to }, "Failed to send class digest email");
        return;
      }
      logger.info(
        { to: params.to, emailId: data?.id },
        "Class digest email sent",
      );
    } catch (err) {
      logger.error({ err, to: params.to }, "Error sending class digest email");
    }
  }

  async sendTermScheduleEmail(
    params: SendTermScheduleEmailParams,
  ): Promise<void> {
    const config = await this.getConfig();
    if (!config?.enabled) {
      logger.warn(
        { to: params.to },
        "Email disabled or missing, skipping term schedule email",
      );
      return;
    }

    const totalSessions = params.sessions.length + (params.truncatedCount ?? 0);
    const hasAttachment = Boolean(params.attachments?.length);
    const attachmentNotice = hasAttachment
      ? {
          filename: params.attachments![0].filename || "Term-Timetable.pdf",
          description: "Your complete term timetable document is attached with all session dates, classroom allocations, and tutor details.",
        }
      : undefined;

    const html = buildResponsiveEmailShell({
      previewText: `${params.termLabel} timetable is ready`,
      badgeText: "Timetable Published",
      badgeTone: "default",
      title: "Your Term Timetable is Ready",
      recipientName: params.fullName,
      introHtml: `<p style="margin:0;">Your schedule for <strong>${escapeHtml(params.termLabel)}</strong> (${escapeHtml(params.termDateRange)}) has been finalised and published.</p>`,
      detailsCardHtml: `
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr>
            <td style="padding: 6px 0; color: #64748B; width: 34%;">Academic Term</td>
            <td style="padding: 6px 0; font-weight: 700; color: #002C23;">${escapeHtml(params.termLabel)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748B;">Term Duration</td>
            <td style="padding: 6px 0; color: #334155;">${escapeHtml(params.termDateRange)}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748B;">Total Sessions</td>
            <td style="padding: 6px 0; font-weight: 600; color: #002C23;">${totalSessions} session${totalSessions === 1 ? "" : "s"}</td>
          </tr>
        </table>
      `,
      attachmentNotice,
      cta: params.actionLink
        ? {
            label: "View Timetable Online",
            url: params.actionLink,
          }
        : undefined,
      secondaryNotice: "Please note that session times or rooms may adjust if holiday schedules apply. Any changes will be updated live in your portal.",
    });

    const resend = new Resend(config.resendApiKey);
    try {
      const { data, error } = await resend.emails.send({
        from: `${config.fromName} <${config.fromEmail}>`,
        to: params.to,
        subject: `${params.termLabel} timetable — Enhance Education`,
        html,
        attachments: this.toResendAttachments(params.attachments),
      });

      if (error) {
        logger.error(
          { error, to: params.to },
          "Failed to send term schedule email",
        );
        return;
      }
      logger.info(
        { to: params.to, emailId: data?.id },
        "Term schedule email sent",
      );
    } catch (err) {
      logger.error({ err, to: params.to }, "Error sending term schedule email");
    }
  }

  /**
   * Best-effort SMS for urgent session cancel/reschedule.
   * Never throws — callers must keep batch delivery resilient.
   */
  async sendSessionChangeSms(
    params: SendSessionChangeSmsParams,
  ): Promise<boolean> {
    const config = await this.getConfig();
    if (
      !config?.smsEnabled ||
      !config.twilioAccountSid ||
      !config.twilioAuthToken ||
      !config.twilioFromNumber
    ) {
      logger.warn(
        { to: params.to },
        "SMS disabled or Twilio unconfigured, skipping session change SMS",
      );
      return false;
    }

    const client = twilio(config.twilioAccountSid, config.twilioAuthToken);

    try {
      const message = await client.messages.create({
        body: params.body,
        from: config.twilioFromNumber,
        to: params.to,
      });

      logger.info(
        { to: params.to, sid: message.sid },
        "Session change SMS sent",
      );
      return true;
    } catch (error) {
      logger.error({ error, to: params.to }, "Failed to send session change SMS");
      return false;
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
        body: `[ENHANCE EDU] Your verification code is ${params.code}. It expires in 10 minutes.`,
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
    return buildResponsiveEmailShell({
      previewText: `Your verification code is ${params.code}`,
      badgeText: "Security Verification",
      badgeTone: "default",
      title: "Your Verification Code",
      recipientName: params.fullName,
      introHtml: `<p style="margin:0;">Enter the one-time verification code below to confirm your account setup or authentication request.</p>`,
      detailsCardHtml: `
        <div style="text-align: center; padding: 10px 0;">
          <div style="font-size: 32px; font-weight: 800; letter-spacing: 0.28em; color: #002C23; font-family: monospace; background: #FFFFFF; border: 1px solid #ECE5DB; display: inline-block; padding: 12px 28px; border-radius: 8px;">
            ${escapeHtml(params.code)}
          </div>
          <p style="margin: 12px 0 0; font-size: 13px; color: #64748B;">This code is valid for <strong>10 minutes</strong> and can only be used once.</p>
        </div>
      `,
      secondaryNotice: "If you did not request this verification code, please disregard this email or contact support if you have security concerns.",
    });
  }

  private buildPasswordResetEmailHtml(
    params: SendPasswordResetEmailParams,
  ): string {
    return buildResponsiveEmailShell({
      previewText: "Reset your Enhance Education account password",
      badgeText: "Account Security",
      badgeTone: "default",
      title: "Reset Your Password",
      recipientName: params.fullName,
      introHtml: `<p style="margin:0;">We received a request to reset the password for your Enhance Education account. Click the button below to choose a secure new password.</p>`,
      cta: {
        label: "Set New Password",
        url: params.resetLink,
      },
      secondaryNotice: "This link will expire in <strong>1 hour</strong>. If you did not request a password reset, you can safely ignore this message.",
      fallbackUrl: params.resetLink,
    });
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

    const html = buildResponsiveEmailShell({
      previewText: `Enrolment update for ${params.studentFullName}`,
      badgeText: "Enrolment Update",
      badgeTone: "amber",
      title: "Enrolment Change to Review",
      recipientName: params.fullName,
      introHtml: `<p style="margin:0;">The centre has updated the enrolment schedule or subject selection for <strong>${escapeHtml(params.studentFullName)}</strong>. Please sign in to review and accept the changes.</p>`,
      cta: {
        label: "Review Enrolment Changes",
        url: params.reviewLink,
      },
      secondaryNotice: "Reviewing and accepting ensures your student's timetable and attendance rosters are up to date.",
      fallbackUrl: params.reviewLink,
    });

    const resend = new Resend(config.resendApiKey);
    const { error } = await resend.emails.send({
      from: `${config.fromName} <${config.fromEmail}>`,
      to: params.to,
      subject: `Enrolment change for ${params.studentFullName}`,
      html,
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

    const hasAttachment = Boolean(params.attachments?.length);
    const attachmentNotice = hasAttachment
      ? {
          filename: params.attachments![0].filename || "Enrolment-Timetable.pdf",
          description: "A timetable document for the selected subjects has been attached for your reference.",
        }
      : undefined;

    const html = buildResponsiveEmailShell({
      previewText: `New enrolment for ${params.studentFullName}`,
      badgeText: "New Enrolment",
      badgeTone: "default",
      title: "New Enrolment Ready to Accept",
      recipientName: params.fullName,
      introHtml: `<p style="margin:0;">The centre has registered a new enrolment for <strong>${escapeHtml(params.studentFullName)}</strong>. Please sign in to review the details, set student credentials, and accept the enrolment.</p>`,
      attachmentNotice,
      cta: {
        label: "Review & Accept Enrolment",
        url: params.reviewLink,
      },
      secondaryNotice: "Please complete this step before term commences to ensure attendance and class materials are allocated.",
      fallbackUrl: params.reviewLink,
    });

    const resend = new Resend(config.resendApiKey);
    const { error } = await resend.emails.send({
      from: `${config.fromName} <${config.fromEmail}>`,
      to: params.to,
      subject: `New enrolment for ${params.studentFullName}`,
      html,
      attachments: this.toResendAttachments(params.attachments),
    });

    if (error) {
      logger.warn({ error, to: params.to }, "Failed to send new enrolment email");
    }
  }

  async sendAdminCommunicationEmail(
    params: SendAdminCommunicationEmailParams,
  ): Promise<string | null> {
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
    const safeBody = escapeHtml(params.bodyText).replace(/\n/g, "<br/>");

    const html = buildResponsiveEmailShell({
      previewText: params.subject,
      badgeText: "Centre Communication",
      badgeTone: "default",
      title: params.subject,
      recipientName: params.fullName,
      contentHtml: `<div style="font-size: 15px; line-height: 1.6; color: #334155;">${safeBody}</div>`,
    });

    const { data, error } = await resend.emails.send({
      from: `${config.fromName} <${config.fromEmail}>`,
      to: params.to,
      subject: params.subject.slice(0, 240),
      html,
      attachments: this.toResendAttachments(params.attachments),
    });

    if (error) {
      logger.error(
        { error, to: params.to },
        "Failed to send admin communication email",
      );
      throw new AppError(
        500,
        "Failed to send email",
        "EMAIL_SEND_FAILED",
        { error },
      );
    }

    logger.info(
      { to: params.to, emailId: data?.id },
      "Admin communication email sent",
    );
    return data?.id ?? null;
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
    const enrollmentCount = params.enrollments?.length ?? 0;
    const trial = Boolean(params.enrollments?.some((row) => row.isTrial));

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

    const hasAttachment = Boolean(params.attachments?.length);
    const attachmentNotice = hasAttachment
      ? {
          filename: params.attachments![0].filename || "Timetable.pdf",
          description: "A complete timetable PDF for the selected subjects is attached to this email.",
        }
      : undefined;

    return buildResponsiveEmailShell({
      previewText: trial ? "Your trial place has been booked" : "You have been invited to Enhance Education",
      badgeText: trial ? "Trial Booking" : "Invitation",
      badgeTone: trial ? "amber" : "default",
      title: trial ? "Your Trial Place is Booked" : "You've Been Invited",
      recipientName: params.fullName,
      introHtml: `<p style="margin:0;">${intro}</p>`,
      detailsCardHtml: enrollmentsHtml || undefined,
      attachmentNotice,
      cta: {
        label: trial ? "Create Trial Accounts" : "Accept Invitation & Set Up Account",
        url: params.invitationLink,
      },
      secondaryNotice: "This invitation link is valid for <strong>48 hours</strong>. If you did not expect this invitation, you can safely ignore this email.",
      fallbackUrl: params.invitationLink,
    });
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
          ? `<tr><td style="padding: 6px 0; color: #64748B; width: 36%;">Year level</td><td style="padding: 6px 0; font-weight: 600; color: #002C23;">Year ${enrollment.yearLevel}</td></tr>`
          : "";
        const subjects = enrollment.subjects.length
          ? escapeHtml(enrollment.subjects.join(", "))
          : "—";
        const fee = formatAud(enrollment.fee);
        const dates = `${formatMailDate(enrollment.termStartDate)} – ${formatMailDate(enrollment.termEndDate)}`;

        return `
        <div style="background: #FFFFFF; border: 1px solid #ECE5DB; border-radius: 8px; padding: 14px 16px; margin: 10px 0;">
          <div style="margin: 0 0 8px; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #DB9027; font-weight: 800;">
            ${enrollment.isTrial ? "Trial booking" : "Enrolment"}
          </div>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
              <td style="padding: 5px 0; color: #64748B; width: 36%;">Student</td>
              <td style="padding: 5px 0; font-weight: 700; color: #002C23;">${escapeHtml(enrollment.studentFullName)}${preferred}</td>
            </tr>
            ${yearLevel}
            <tr>
              <td style="padding: 5px 0; color: #64748B;">Term</td>
              <td style="padding: 5px 0; font-weight: 600; color: #002C23;">${escapeHtml(enrollment.termName)}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #64748B;">Dates</td>
              <td style="padding: 5px 0; color: #334155;">${dates}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #64748B;">Subjects</td>
              <td style="padding: 5px 0; color: #334155;">${subjects}</td>
            </tr>
            ${
              enrollment.isTrial
                ? ""
                : `<tr>
              <td style="padding: 5px 0; color: #64748B;">Tuition Fee</td>
              <td style="padding: 5px 0; font-weight: 700; color: #002C23;">${fee}</td>
            </tr>`
            }
          </table>
        </div>`;
      })
      .join("");

    return `
      <div>
        <p style="margin: 0 0 10px; font-size: 13px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #64748B;">${enrollments.some((row) => row.isTrial) ? "Trial Details" : "Enrolment Summary"}</p>
        ${cards}
        <p style="margin: 10px 0 0; font-size: 13px; color: #64748B;">When you accept, you will configure a student portal login password.</p>
      </div>
    `;
  }

  private buildTrialBookingEmailHtml(params: SendTrialBookingEmailParams): string {
    const enrollmentsHtml = this.buildEnrollmentDetailsHtml(
      params.enrollments.map((row) => ({ ...row, isTrial: true })),
    );
    const intro = params.isNewAccount
      ? "We've reserved a trial place. Create your guardian account and a trial login for your student using the button below."
      : "We've reserved a trial place. Sign in to accept it and set your student's trial login.";

    return buildResponsiveEmailShell({
      previewText: "Your trial place is reserved",
      badgeText: "Trial Booking",
      badgeTone: "amber",
      title: "Your Trial Place is Booked",
      recipientName: params.fullName,
      introHtml: `<p style="margin:0;">${intro}</p>`,
      detailsCardHtml: enrollmentsHtml,
      cta: {
        label: params.actionLabel,
        url: params.actionLink,
      },
      fallbackUrl: params.actionLink,
    });
  }
}

interface ResponsiveEmailOptions {
  previewText?: string;
  badgeText?: string;
  badgeTone?: "default" | "amber" | "emergency" | "info" | "success";
  title: string;
  recipientName?: string;
  introHtml?: string;
  contentHtml?: string;
  detailsCardHtml?: string;
  attachmentNotice?: {
    filename?: string;
    description?: string;
  };
  cta?: {
    label: string;
    url: string;
  };
  secondaryNotice?: string;
  fallbackUrl?: string;
  footerNote?: string;
}

function buildResponsiveEmailShell(options: ResponsiveEmailOptions): string {
  const {
    previewText,
    badgeText,
    badgeTone = "default",
    title,
    recipientName,
    introHtml,
    contentHtml,
    detailsCardHtml,
    attachmentNotice,
    cta,
    secondaryNotice,
    fallbackUrl = cta?.url,
    footerNote,
  } = options;

  let badgeBg = "#FAF7F2";
  let badgeColor = "#002C23";
  let badgeBorder = "#ECE5DB";

  if (badgeTone === "amber") {
    badgeBg = "#FEF3E2";
    badgeColor = "#935105";
    badgeBorder = "#FCDCA8";
  } else if (badgeTone === "emergency") {
    badgeBg = "#FEF2F2";
    badgeColor = "#991B1B";
    badgeBorder = "#FECACA";
  } else if (badgeTone === "info") {
    badgeBg = "#F0F7F6";
    badgeColor = "#004D40";
    badgeBorder = "#CCE3DE";
  } else if (badgeTone === "success") {
    badgeBg = "#ECFDF5";
    badgeColor = "#065F46";
    badgeBorder = "#A7F3D0";
  }

  const badgeHtml = badgeText
    ? `<span style="display: inline-block; padding: 4px 12px; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; border-radius: 9999px; background-color: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder}; margin-bottom: 14px;">${escapeHtml(badgeText)}</span>`
    : "";

  const greetingHtml = recipientName
    ? `<p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6; color: #1C2421;">Hi <strong>${escapeHtml(recipientName)}</strong>,</p>`
    : "";

  const introParagraph = introHtml
    ? `<div style="margin: 0 0 16px; font-size: 15px; line-height: 1.6; color: #334155;">${introHtml}</div>`
    : "";

  const contentSection = contentHtml
    ? `<div style="margin: 0 0 16px; font-size: 15px; line-height: 1.6; color: #334155;">${contentHtml}</div>`
    : "";

  const cardSection = detailsCardHtml
    ? `<div style="background-color: #FAF7F2; border: 1px solid #ECE5DB; border-radius: 10px; padding: 18px 20px; margin: 18px 0;">${detailsCardHtml}</div>`
    : "";

  const attachmentSection = attachmentNotice
    ? `
    <div style="background-color: #F8FAFC; border: 1px dashed #CBD5E1; border-radius: 8px; padding: 14px 16px; margin: 18px 0;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td width="32" valign="middle" style="font-size: 22px; line-height: 1;">📄</td>
          <td valign="middle" style="padding-left: 10px;">
            <p style="margin: 0; font-size: 13.5px; font-weight: 700; color: #002C23;">${escapeHtml(attachmentNotice.filename || "Attached Document (PDF)")}</p>
            <p style="margin: 3px 0 0; font-size: 12px; color: #64748B;">${escapeHtml(attachmentNotice.description || "A formal document is attached to this email.")}</p>
          </td>
        </tr>
      </table>
    </div>`
    : "";

  const ctaSection = cta
    ? `
    <div style="text-align: center; margin: 28px 0 24px;">
      <a href="${escapeHtml(cta.url)}" class="brand-btn" style="background-color: #002C23; color: #FFFFFF !important; text-decoration: none; padding: 13px 32px; border-radius: 8px; font-weight: 700; font-size: 15px; display: inline-block; letter-spacing: 0.01em; box-shadow: 0 2px 6px rgba(0, 44, 35, 0.15);">
        ${escapeHtml(cta.label)}
      </a>
    </div>`
    : "";

  const secondaryNoticeSection = secondaryNotice
    ? `<p style="margin: 16px 0 0; font-size: 13px; line-height: 1.5; color: #64748B; text-align: left;">${secondaryNotice}</p>`
    : "";

  const fallbackLinkSection =
    fallbackUrl && cta
      ? `
    <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #ECE5DB; font-size: 12px; line-height: 1.5; color: #8C827A;">
      If the button above does not work, copy and paste this link into your browser:<br/>
      <a href="${escapeHtml(fallbackUrl)}" style="color: #DB9027; word-break: break-all; text-decoration: underline;">${escapeHtml(fallbackUrl)}</a>
    </div>`
      : "";

  const previewSnippet = previewText
    ? `<div style="display:none;font-size:1px;color:#333333;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${escapeHtml(previewText)}</div>`
    : "";

  return `
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${escapeHtml(title)}</title>
  <style type="text/css">
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    table { border-collapse: collapse !important; }
    body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #F5F2EC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    @media only screen and (max-width: 600px) {
      .email-container { width: 100% !important; max-width: 100% !important; }
      .email-content { padding: 22px 18px !important; }
      .brand-btn { display: block !important; width: auto !important; text-align: center !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 24px 12px; background-color: #F5F2EC; -webkit-font-smoothing: antialiased;">
  ${previewSnippet}
  <table border="0" cellpadding="0" cellspacing="0" width="100%">
    <tr>
      <td align="center" style="padding: 0;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 580px;" class="email-container">
          <!-- Header Branding -->
          <tr>
            <td align="left" style="padding: 0 0 16px 4px;">
              <table border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size: 15px; font-weight: 800; letter-spacing: 0.08em; color: #002C23; text-transform: uppercase;">
                    <span style="color: #DB9027;">●</span> ENHANCE EDUCATION
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Main Card -->
          <tr>
            <td style="background-color: #FFFFFF; border: 1px solid #ECE5DB; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.04);" class="email-content">
              <!-- Top accent banner -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td height="4" style="background: linear-gradient(90deg, #002C23 0%, #004D40 70%, #DB9027 100%);"></td>
                </tr>
              </table>
              <div style="padding: 28px 28px 24px;">
                ${badgeHtml}
                <h1 style="margin: 0 0 18px; font-size: 22px; font-weight: 700; color: #002C23; line-height: 1.3;">${escapeHtml(title)}</h1>
                ${greetingHtml}
                ${introParagraph}
                ${cardSection}
                ${contentSection}
                ${attachmentSection}
                ${ctaSection}
                ${secondaryNoticeSection}
                ${fallbackLinkSection}
              </div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" style="padding: 20px 12px 10px; font-size: 12px; line-height: 1.5; color: #8C827A; text-align: center;">
              <p style="margin: 0 0 6px; font-weight: 600;">Enhance Education · Academic Excellence</p>
              ${footerNote ? `<p style="margin: 0 0 4px;">${escapeHtml(footerNote)}</p>` : ""}
              <p style="margin: 0; font-size: 11px; color: #A8A099;">This is an automated notification. Please contact the centre admin if you need assistance.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
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
