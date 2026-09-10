import Joi from "joi";
import { env } from "../../../config/env.js";

export const sendAdminAiMessageSchema = Joi.object({
  content: Joi.string()
    .trim()
    .min(1)
    .max(env.ADMIN_AI_MAX_MESSAGE_CHARS)
    .required(),
  threadId: Joi.string().uuid().allow(null).optional(),
});

export const adminAiThreadIdParamsSchema = Joi.object({
  threadId: Joi.string().uuid().required(),
});

export const adminAiMemoryIdParamsSchema = Joi.object({
  memoryId: Joi.string().uuid().required(),
});

export const adminAiReportIdParamsSchema = Joi.object({
  reportId: Joi.string().uuid().required(),
});

export const adminAiDraftIdParamsSchema = Joi.object({
  draftId: Joi.string().uuid().required(),
});

export const listAdminAiThreadsQuerySchema = Joi.object({
  cursor: Joi.string().uuid().optional(),
});
