import Joi from "joi";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const teacherSessionsUpcomingQuerySchema = Joi.object({
  subject: Joi.string().trim().max(120).allow("").optional(),
  range: Joi.string().valid("initial", "week").default("initial"),
  weekStart: Joi.when("range", {
    is: "week",
    then: Joi.string().pattern(datePattern).required(),
    otherwise: Joi.string().pattern(datePattern).optional(),
  }),
});

export const teacherSessionsPastQuerySchema = Joi.object({
  subject: Joi.string().trim().max(120).allow("").optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(15),
});

export const teacherSessionIdParamsSchema = Joi.object({
  sessionId: Joi.string().uuid().required(),
});
