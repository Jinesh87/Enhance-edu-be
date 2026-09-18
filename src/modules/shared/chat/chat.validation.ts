import Joi from "joi";

export const openConversationSchema = Joi.object({
  peerUserId: Joi.string().uuid().required(),
});

export const conversationIdParamsSchema = Joi.object({
  conversationId: Joi.string().uuid().required(),
});

export const messageMediaParamsSchema = Joi.object({
  conversationId: Joi.string().uuid().required(),
  messageId: Joi.string().uuid().required(),
});

export const listMessagesQuerySchema = Joi.object({
  before: Joi.string().uuid().optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
});

export const sendChatMessageSchema = Joi.object({
  body: Joi.string().trim().allow("").max(4000).optional().default(""),
  replyToMessageId: Joi.string().uuid().optional().allow(null, ""),
  directUploads: Joi.alternatives()
    .try(Joi.string(), Joi.array().items(Joi.object().unknown(true)))
    .optional(),
});

export const editChatMessageSchema = Joi.object({
  body: Joi.string().trim().min(1).max(4000).required(),
});

export const muteConversationSchema = Joi.object({
  muted: Joi.boolean().required(),
});

export const listConversationMediaQuerySchema = Joi.object({
  kind: Joi.string().valid("image", "document", "all").optional(),
  limit: Joi.number().integer().min(1).max(400).optional(),
});

export const searchChatQuerySchema = Joi.object({
  q: Joi.string().trim().min(1).max(120).required(),
});

export const searchConversationMessagesQuerySchema = Joi.object({
  q: Joi.string().trim().min(1).max(120).required(),
  limit: Joi.number().integer().min(1).max(100).optional(),
});
