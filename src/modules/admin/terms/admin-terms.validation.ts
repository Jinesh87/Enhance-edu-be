import Joi from "joi";

const dateField = Joi.string()
  .trim()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .required()
  .messages({
    "string.pattern.base": "Date must be in YYYY-MM-DD format",
  });

export const createTermSchema = Joi.object({
  name: Joi.string().trim().min(1).max(120).required(),
  startDate: dateField,
  endDate: dateField,
});

export const updateTermSchema = Joi.object({
  name: Joi.string().trim().min(1).max(120).required(),
  startDate: dateField,
  endDate: dateField,
});

export const termIdParamsSchema = Joi.object({
  id: Joi.string().uuid().required(),
});
