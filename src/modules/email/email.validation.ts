import Joi from "joi";

export const updateMessagingConfigSchema = Joi.object({
  resendApiKey: Joi.string().min(1).max(255).required(),
  fromEmail: Joi.string().email().max(255).required(),
  fromName: Joi.string().min(1).max(255).required(),
  enabled: Joi.boolean().required(),
  twilioAccountSid: Joi.when("smsEnabled", {
    is: true,
    then: Joi.string().trim().min(1).max(255).required(),
    otherwise: Joi.string().trim().max(255).allow("", null),
  }),
  twilioAuthToken: Joi.when("smsEnabled", {
    is: true,
    then: Joi.string().trim().min(1).max(255).required(),
    otherwise: Joi.string().trim().max(255).allow("", null),
  }),
  twilioFromNumber: Joi.when("smsEnabled", {
    is: true,
    then: Joi.string().trim().min(8).max(40).required(),
    otherwise: Joi.string().trim().max(40).allow("", null),
  }),
  smsEnabled: Joi.boolean().required(),
});
