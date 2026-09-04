import Joi from "joi";

export const notificationIdParamsSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

export const listNotificationsQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(100).optional(),
  unreadOnly: Joi.alternatives()
    .try(Joi.boolean(), Joi.string().valid("true", "false"))
    .optional(),
});
