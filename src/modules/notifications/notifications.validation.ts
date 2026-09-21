import Joi from "joi";

export const notificationIdParamsSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

export const listNotificationsQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(100).optional(),
  unreadOnly: Joi.alternatives()
    .try(Joi.boolean(), Joi.string().valid("true", "false"))
    .optional(),
  cursor: Joi.string().isoDate().optional(),
  type: Joi.string().trim().max(60).optional(),
});

export const pushSubscribeBodySchema = Joi.object({
  endpoint: Joi.string().uri().max(2048).required(),
  keys: Joi.object({
    p256dh: Joi.string().trim().min(1).max(255).required(),
    auth: Joi.string().trim().min(1).max(255).required(),
  }).required(),
  userAgent: Joi.string().trim().max(255).allow("", null).optional(),
});

export const pushUnsubscribeBodySchema = Joi.object({
  endpoint: Joi.string().uri().max(2048).required(),
});
