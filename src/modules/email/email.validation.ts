import Joi from "joi";

export const updateEmailConfigSchema = Joi.object({
  resendApiKey: Joi.string().min(1).max(255).required(),
  fromEmail: Joi.string().email().max(255).required(),
  fromName: Joi.string().min(1).max(255).required(),
  enabled: Joi.boolean().required(),
});
