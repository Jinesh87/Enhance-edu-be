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
  academicYear: Joi.number().integer().min(1900).max(2100).required(),
  yearLevel: Joi.string().trim().min(1).max(40).required(),
  classroomId: Joi.string().uuid().allow(null, "").optional(),
  startDate: dateField,
  endDate: dateField,
  isTrial: Joi.boolean().default(false),
});

export const updateTermSchema = Joi.object({
  name: Joi.string().trim().min(1).max(120).required(),
  academicYear: Joi.number().integer().min(1900).max(2100).required(),
  yearLevel: Joi.string().trim().min(1).max(40).required(),
  classroomId: Joi.string().uuid().allow(null, "").optional(),
  startDate: dateField,
  endDate: dateField,
  isTrial: Joi.boolean().default(false),
});

export const termIdParamsSchema = Joi.object({
  id: Joi.string().uuid().required(),
});
