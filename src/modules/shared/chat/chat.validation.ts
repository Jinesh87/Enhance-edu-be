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

export const messageMediaQuerySchema = Joi.object({
  variant: Joi.string().valid("full", "thumb").optional(),
});

export const listMessagesQuerySchema = Joi.object({
  before: Joi.string().uuid().optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
});

export const sendChatMessageSchema = Joi.object({
  body: Joi.string().trim().allow("").max(16000).optional().default(""),
  encryptionVersion: Joi.number().integer().valid(0, 1).optional().default(0),
  replyToMessageId: Joi.string().uuid().optional().allow(null, ""),
  /** When encryptionVersion=1, real attachment MIME (server stores encrypted octets). */
  encryptedAttachmentMime: Joi.string().trim().max(120).optional().allow("", null),
  encryptedAttachmentName: Joi.string().trim().max(255).optional().allow("", null),
  directUploads: Joi.alternatives()
    .try(Joi.string(), Joi.array().items(Joi.object().unknown(true)))
    .optional(),
});

export const editChatMessageSchema = Joi.object({
  body: Joi.string().trim().min(1).max(16000).required(),
  encryptionVersion: Joi.number().integer().valid(0, 1).optional().default(0),
});

export const upsertChatPublicKeySchema = Joi.object({
  publicKey: Joi.string().trim().min(32).max(2048).required(),
});

export const chatUserIdParamsSchema = Joi.object({
  userId: Joi.string().uuid().required(),
});

export const chatPublicKeysQuerySchema = Joi.object({
  userIds: Joi.alternatives()
    .try(
      Joi.string().trim().min(1),
      Joi.array().items(Joi.string().uuid()).min(1).max(50),
    )
    .required(),
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
