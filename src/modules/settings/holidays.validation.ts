import Joi from "joi";

const dateField = Joi.string()
  .trim()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .required()
  .messages({
    "string.pattern.base": "Date must be in YYYY-MM-DD format",
  });

const holidayBodySchema = Joi.object({
  name: Joi.string().trim().min(1).max(120).required(),
  kind: Joi.string().valid("PUBLIC", "TERM").required(),
  termId: Joi.when("kind", {
    is: "TERM",
    then: Joi.string().uuid().required(),
    otherwise: Joi.valid(null).optional(),
  }),
  startDate: dateField,
  endDate: dateField,
});

export const createHolidaySchema = holidayBodySchema;

export const updateHolidaySchema = holidayBodySchema;

export const holidayIdParamsSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

export const listHolidaysQuerySchema = Joi.object({
  kind: Joi.string().valid("PUBLIC", "TERM").optional(),
  termId: Joi.string().uuid().optional(),
});
