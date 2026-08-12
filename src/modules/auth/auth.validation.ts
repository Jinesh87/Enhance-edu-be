import Joi from "joi";

export const loginSchema = Joi.object({
  email: Joi.string().trim().email().required(),
  password: Joi.string().required(),
});

export const acceptInvitationSchema = Joi.object({
  email: Joi.string().trim().email().required(),
  token: Joi.string().trim().min(20).required(),
  password: Joi.string().min(8).max(128).required(),
  confirmPassword: Joi.string().valid(Joi.ref("password")).required().messages({
    "any.only": "Passwords do not match",
  }),
  preferredName: Joi.string().trim().max(80).allow(null, ""),
});
