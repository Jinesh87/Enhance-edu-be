import Joi from "joi";
import { TwoFactorMethod } from "../../common/constants/roles.js";

export const loginSchema = Joi.object({
  email: Joi.string().trim().email().required(),
  password: Joi.string().required(),
});

export const invitationPreviewQuerySchema = Joi.object({
  token: Joi.string().trim().min(20).required(),
});

export const invitationPasswordSchema = Joi.object({
  email: Joi.string().trim().email().required(),
  token: Joi.string().trim().min(20).required(),
  password: Joi.string().min(8).max(128).required(),
  confirmPassword: Joi.string().valid(Joi.ref("password")).required().messages({
    "any.only": "Passwords do not match",
  }),
  preferredName: Joi.string().trim().max(80).allow(null, ""),
});

export const invitation2faMethodSchema = Joi.object({
  setupId: Joi.string().trim().min(20).required(),
  method: Joi.string()
    .valid(...Object.values(TwoFactorMethod))
    .required(),
  mobile: Joi.when("method", {
    is: TwoFactorMethod.SMS,
    then: Joi.string().trim().min(8).max(30).required(),
    otherwise: Joi.string().trim().max(30).allow(null, ""),
  }),
});

export const invitationSetupIdSchema = Joi.object({
  setupId: Joi.string().trim().min(20).required(),
});

export const invitationVerify2faSchema = Joi.object({
  setupId: Joi.string().trim().min(20).required(),
  code: Joi.string().trim().length(6).pattern(/^\d+$/).required().messages({
    "string.length": "Code must be 6 digits",
    "string.pattern.base": "Code must be 6 digits",
  }),
});

// Kept for backward compatibility
export const acceptInvitationSchema = invitationPasswordSchema;
