import Joi from "joi";

export const sendGuardianCoachMessageSchema = Joi.object({
  content: Joi.string().trim().min(1).max(4000).required(),
  threadId: Joi.string().uuid().allow(null).optional(),
});

export const guardianCoachConversationQuerySchema = Joi.object({
  threadId: Joi.string().uuid().optional(),
});

export const guardianCoachThreadIdParamsSchema = Joi.object({
  threadId: Joi.string().uuid().required(),
});
