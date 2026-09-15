import Joi from "joi";

export const openConversationSchema = Joi.object({
  peerUserId: Joi.string().uuid().required(),
});

export const conversationIdParamsSchema = Joi.object({
  conversationId: Joi.string().uuid().required(),
});

export const listMessagesQuerySchema = Joi.object({
  before: Joi.string().uuid().optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
});

export const sendChatMessageSchema = Joi.object({
  body: Joi.string().trim().min(1).max(4000).required(),
});

export const searchChatQuerySchema = Joi.object({
  q: Joi.string().trim().min(1).max(120).required(),
});
