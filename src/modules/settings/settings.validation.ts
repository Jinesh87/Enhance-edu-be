import Joi from "joi";

export const updateInstitutionSettingSchema = Joi.object({
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
});

export const updateSecuritySettingSchema = Joi.object({
  login2faEnabled: Joi.boolean().required(),
  sandboxModeEnabled: Joi.boolean().required(),
});

export const updateGuardianPortalSettingSchema = Joi.object({
  classDetailsEnabled: Joi.boolean().required(),
  assessmentsEnabled: Joi.boolean().required(),
  entranceExamsEnabled: Joi.boolean().required(),
  attendanceEnabled: Joi.boolean().required(),
});

export const updateOpenAiSettingSchema = Joi.object({
  openaiApiKey: Joi.string().trim().max(255).allow("", null).required(),
});

export const updateNotificationSettingSchema = Joi.object({
  sessionChangeEmailNotificationsEnabled: Joi.boolean().required(),
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
    daysOfWeek: Joi.array()
      .items(Joi.number().integer().min(0).max(6))
      .max(7)
      .optional(),
    sections: Joi.array().items(Joi.string().trim().max(40)).max(12).optional(),
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
