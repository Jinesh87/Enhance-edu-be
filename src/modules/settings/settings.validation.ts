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
