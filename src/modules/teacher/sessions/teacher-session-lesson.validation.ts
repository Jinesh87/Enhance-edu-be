import Joi from "joi";

export const sessionLessonParamsSchema = Joi.object({
  sessionId: Joi.string().uuid().required(),
});

export const sessionLessonResourceParamsSchema = Joi.object({
  sessionId: Joi.string().uuid().required(),
  resourceId: Joi.string().uuid().required(),
});

export const upsertSessionLessonSchema = Joi.object({
  title: Joi.string().trim().min(1).max(200).required(),
  description: Joi.string().trim().max(10000).allow("", null).optional(),
  objectives: Joi.string().trim().max(10000).allow("", null).optional(),
  sequence: Joi.string().trim().max(10000).allow("", null).optional(),
  watchFor: Joi.string().trim().max(10000).allow("", null).optional(),
  notes: Joi.string().trim().max(10000).allow("", null).optional(),
});

export const updateSessionResourceSchema = Joi.object({
  title: Joi.string().trim().min(1).max(255).optional(),
  description: Joi.string().trim().max(5000).allow("", null).optional(),
});
