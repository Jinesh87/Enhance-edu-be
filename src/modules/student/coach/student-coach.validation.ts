import Joi from "joi";

export const sendCoachMessageSchema = Joi.object({
  content: Joi.string().trim().min(1).max(4000).required(),
  threadId: Joi.string().uuid().allow(null).optional(),
});
