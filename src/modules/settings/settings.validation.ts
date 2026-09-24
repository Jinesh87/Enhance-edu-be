import Joi from "joi";

export const updateInstitutionSettingSchema = Joi.object({
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
});

export const updateSecuritySettingSchema = Joi.object({
  login2faEnabled: Joi.boolean().required(),
  sandboxModeEnabled: Joi.boolean().required(),
  teacherPayrollEnabled: Joi.boolean().required(),
});

export const updateGuardianPortalSettingSchema = Joi.object({
  classDetailsEnabled: Joi.boolean().required(),
  assessmentsEnabled: Joi.boolean().required(),
  entranceExamsEnabled: Joi.boolean().required(),
  attendanceEnabled: Joi.boolean().required(),
  teacherChatEnabled: Joi.boolean().required(),
  teacherPeerChatEnabled: Joi.boolean().required(),
  adminChatEnabled: Joi.boolean().required(),
  officeStaffChatEnabled: Joi.boolean().required(),
  studentAdminChatEnabled: Joi.boolean().required(),
  officeTeacherChatEnabled: Joi.boolean().required(),
  officeAdminChatEnabled: Joi.boolean().required(),
  teacherAdminChatEnabled: Joi.boolean().required(),
});

export const updateOpenAiSettingSchema = Joi.object({
  openaiApiKey: Joi.string().trim().max(255).allow("", null).required(),
});

export const updateNotificationSettingSchema = Joi.object({
  sessionChangeEmailNotificationsEnabled: Joi.boolean().required(),
  classReminderDigestEnabled: Joi.boolean().required(),
  classReminder1hPushEnabled: Joi.boolean().required(),
  classReminderDigestHour: Joi.number().integer().min(0).max(23).required(),
  urgentCancelSmsEnabled: Joi.boolean().required(),
  termScheduleEmailNotificationsEnabled: Joi.boolean().required(),
  absenceAlertInAppEnabled: Joi.boolean().required(),
  absenceAlertEmailEnabled: Joi.boolean().required(),
  absenceAlertSmsEnabled: Joi.boolean().required(),
  homeworkCreatedInAppEnabled: Joi.boolean().required(),
  homeworkDueSoonEnabled: Joi.boolean().required(),
  homeworkOverdueInAppEnabled: Joi.boolean().required(),
  homeworkOverdueEmailEnabled: Joi.boolean().required(),
  homeworkGradedEnabled: Joi.boolean().required(),
  homeworkSubmittedEnabled: Joi.boolean().required(),
  enquiryCreatedNotifyEnabled: Joi.boolean().required(),
  trialBookingConfirmedNotifyEnabled: Joi.boolean().required(),
  enrollmentAcceptedNotifyEnabled: Joi.boolean().required(),
  classRosterStudentAddedNotifyEnabled: Joi.boolean().required(),
  holidayReminderInAppEnabled: Joi.boolean().required(),
  holidayReminderEmailEnabled: Joi.boolean().required(),
  announcementEmailEnabled: Joi.boolean().required(),
  emergencyAlertInAppEnabled: Joi.boolean().required(),
  emergencyAlertEmailEnabled: Joi.boolean().required(),
  emergencyAlertSmsEnabled: Joi.boolean().required(),
});

export const updateAdminAiCapabilitySettingSchema = Joi.object({
  assistantEnabled: Joi.boolean().required(),
  dataInsightsEnabled: Joi.boolean().required(),
  emailDraftingEnabled: Joi.boolean().required(),
  messageDraftingEnabled: Joi.boolean().required(),
  bulkCommunicationEnabled: Joi.boolean().required(),
  notificationSuggestionsEnabled: Joi.boolean().required(),
  proactiveBriefingEnabled: Joi.boolean().required(),
  reportBuilderEnabled: Joi.boolean().required(),
  deepLinksEnabled: Joi.boolean().required(),
  confirmedActionsEnabled: Joi.boolean().required(),
  briefingConfig: Joi.object({
    time: Joi.string()
      .pattern(/^\d{2}:\d{2}$/)
      .allow(null)
      .optional(),
    timeZone: Joi.string().trim().max(64).allow(null, "").optional(),
    daysOfWeek: Joi.array()
      .items(Joi.number().integer().min(0).max(6))
      .max(7)
      .optional(),
    sections: Joi.array()
      .items(
        Joi.string().valid(
          "attendance",
          "tasks",
          "enquiries",
          "homework",
          "operations",
        ),
      )
      .max(12)
      .optional(),
    startDate: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .allow(null)
      .optional(),
    endDate: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .allow(null)
      .optional(),
    nextRunAt: Joi.string().isoDate().allow(null).optional(),
    lastRunAt: Joi.string().isoDate().allow(null).optional(),
  })
    .allow(null)
    .optional(),
});

export const openAiUsageQuerySchema = Joi.object({
  from: Joi.string().trim().max(40).optional(),
  to: Joi.string().trim().max(40).optional(),
  feature: Joi.string().trim().max(80).allow("").optional(),
  status: Joi.string().valid("success", "error").optional(),
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
});
