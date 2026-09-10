import Joi from "joi";

export const sendTeacherCoachMessageSchema = Joi.object({
  content: Joi.string().trim().min(1).max(4000).required(),
  threadId: Joi.string().uuid().allow(null).optional(),
});

export const teacherCoachConversationQuerySchema = Joi.object({
  threadId: Joi.string().uuid().optional(),
});

export const teacherCoachThreadIdParamsSchema = Joi.object({
  threadId: Joi.string().uuid().required(),
});
