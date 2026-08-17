import Joi from "joi";

export const createSubjectSchema = Joi.object({
  name: Joi.string().trim().min(1).max(120).required(),
  yearLevelId: Joi.string().uuid().allow(null, ""),
});

export const updateSubjectSchema = Joi.object({
  name: Joi.string().trim().min(1).max(120).required(),
  yearLevelId: Joi.string().uuid().allow(null, ""),
});

export const subjectIdParamsSchema = Joi.object({
  id: Joi.string().uuid().required(),
});
