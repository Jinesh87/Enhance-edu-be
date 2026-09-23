import Joi from "joi";
import { env } from "../../../config/env.js";

export const adminAiMentionItemSchema = Joi.object({
  type: Joi.string().valid("person").required(),
  userId: Joi.string().uuid().required(),
  role: Joi.string().trim().max(40).optional(),
  label: Joi.string().trim().max(120).required(),
});

export const sendAdminAiMessageSchema = Joi.object({
  content: Joi.string()
    .trim()
    .min(1)
    .max(env.ADMIN_AI_MAX_MESSAGE_CHARS)
    .required(),
  threadId: Joi.string().uuid().allow(null).optional(),
  mentions: Joi.array().items(adminAiMentionItemSchema).max(10).optional(),
  actionCommand: Joi.string()
    .valid("email", "announcement", "bulk-email", "bulk-message", "emergency")
    .optional(),
});

export const listPeopleMentionsQuerySchema = Joi.object({
  q: Joi.string().trim().max(100).allow("").optional(),
  roles: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string().trim().max(40)).max(10),
      Joi.string().trim().max(200),
    )
    .optional(),
  limit: Joi.number().integer().min(1).max(30).default(10),
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

export const adminAiBulkActionIdParamsSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

export const adminAiBriefingIdParamsSchema = Joi.object({
  briefingId: Joi.string().uuid().required(),
});

export const listAdminAiBriefingsQuerySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(30).optional(),
});

export const previewBulkActionSchema = Joi.object({
  draftId: Joi.string().uuid().required(),
});

export const updateCommunicationDraftSchema = Joi.object({
  subject: Joi.string().trim().max(240).allow("").optional(),
  body: Joi.string().trim().max(20000).allow("").optional(),
  refreshAudience: Joi.boolean().optional(),
  audienceType: Joi.string().trim().max(64).optional(),
  roles: Joi.array().items(Joi.string().trim().max(40)).max(8).optional(),
  groups: Joi.array().items(Joi.string().trim().max(40)).max(8).optional(),
  yearLevel: Joi.string().trim().max(80).allow("", null).optional(),
  term: Joi.string().trim().max(80).allow("", null).optional(),
  subjectFilter: Joi.string().trim().max(80).allow("", null).optional(),
  className: Joi.string().trim().max(120).allow("", null).optional(),
  date: Joi.string().trim().max(32).allow("", null).optional(),
  nameQuery: Joi.string().trim().max(120).allow("", null).optional(),
  userIds: Joi.array().items(Joi.string().uuid()).max(500).optional(),
  selectedUserIds: Joi.array().items(Joi.string().uuid()).max(500).optional(),
  recipientOf: Joi.string()
    .valid("SELF", "PARENTS", "self", "parents")
    .optional(),
  assessmentQuery: Joi.string().trim().max(120).allow("", null).optional(),
  enquiryStage: Joi.string().trim().max(80).allow("", null).optional(),
  status: Joi.string().trim().max(40).allow("", null).optional(),
  label: Joi.string().trim().max(180).allow("", null).optional(),
  ambiguous: Joi.boolean().optional(),
  confirmed: Joi.boolean().optional(),
});

export const confirmSendCommunicationSchema = Joi.object({
  password: Joi.string().allow("").optional(),
  subject: Joi.string().trim().min(1).max(240).optional(),
  body: Joi.string().trim().min(1).max(20000).optional(),
  retryFailedOnly: Joi.boolean().optional(),
  selectedUserIds: Joi.array().items(Joi.string().uuid()).max(500).optional(),
  confirmationText: Joi.string().trim().max(40).allow("").optional(),
  action: Joi.string().valid("send_email").optional(),
  attachments: Joi.array()
    .items(
      Joi.object({
        filename: Joi.string().trim().min(1).max(180).required(),
        contentBase64: Joi.string().trim().min(1).max(2_800_000).required(),
        mimeType: Joi.string().trim().max(120).allow("", null).optional(),
      }),
    )
    .max(3)
    .optional(),
});

export const confirmBulkActionSchema = confirmSendCommunicationSchema;

export const retryFailedBulkActionSchema = Joi.object({
  password: Joi.string().allow("").optional(),
  confirmationText: Joi.string().trim().max(40).allow("").optional(),
});

export const listAdminAiThreadsQuerySchema = Joi.object({
  cursor: Joi.string().uuid().optional(),
});

export const previewAnnouncementSchema = Joi.object({
  title: Joi.string().trim().max(200).allow("").optional(),
  message: Joi.string().trim().max(4000).allow("").optional(),
  severity: Joi.string().valid("GENERAL", "EMERGENCY", "general", "emergency").optional(),
  audience: Joi.object({
    roles: Joi.array().items(Joi.string().trim()).max(8).optional(),
    groups: Joi.array().items(Joi.string().trim()).max(8).optional(),
    recipientOf: Joi.string().valid("SELF", "PARENTS", "self", "parents").optional(),
    yearLevel: Joi.string().trim().max(80).allow(null, "").optional(),
    term: Joi.string().trim().max(80).allow(null, "").optional(),
    subject: Joi.string().trim().max(80).allow(null, "").optional(),
    className: Joi.string().trim().max(80).allow(null, "").optional(),
    date: Joi.string().trim().max(32).allow(null, "").optional(),
    nameQuery: Joi.string().trim().max(120).allow(null, "").optional(),
    userIds: Joi.array().items(Joi.string().uuid()).max(500).optional(),
    assessmentQuery: Joi.string().trim().max(120).allow(null, "").optional(),
    enquiryStage: Joi.string().trim().max(80).allow(null, "").optional(),
    status: Joi.string().trim().max(40).allow(null, "").optional(),
    label: Joi.string().trim().max(180).allow(null, "").optional(),
    ambiguous: Joi.boolean().optional(),
    confirmed: Joi.boolean().optional(),
    type: Joi.string().trim().max(64).allow(null, "").optional(),
  })
    .unknown(true)
    .optional(),
  threadId: Joi.string().uuid().allow(null, "").optional(),
});

export const publishAnnouncementSchema = Joi.object({
  title: Joi.string().trim().min(1).max(200).required(),
  message: Joi.string().trim().min(1).max(4000).required(),
  severity: Joi.string().valid("GENERAL", "EMERGENCY", "general", "emergency").optional(),
  deliveryChannel: Joi.string().trim().max(64).optional(),
  idempotencyKey: Joi.string().trim().max(100).optional(),
  excludedUserIds: Joi.array().items(Joi.string().uuid()).max(2000).optional(),
  audience: Joi.object({
    roles: Joi.array().items(Joi.string().trim()).max(8).optional(),
    groups: Joi.array().items(Joi.string().trim()).max(8).optional(),
    recipientOf: Joi.string().valid("SELF", "PARENTS", "self", "parents").optional(),
    yearLevel: Joi.string().trim().max(80).allow(null, "").optional(),
    term: Joi.string().trim().max(80).allow(null, "").optional(),
    subject: Joi.string().trim().max(80).allow(null, "").optional(),
    className: Joi.string().trim().max(80).allow(null, "").optional(),
    date: Joi.string().trim().max(32).allow(null, "").optional(),
    nameQuery: Joi.string().trim().max(120).allow(null, "").optional(),
    userIds: Joi.array().items(Joi.string().uuid()).max(500).optional(),
    assessmentQuery: Joi.string().trim().max(120).allow(null, "").optional(),
    enquiryStage: Joi.string().trim().max(80).allow(null, "").optional(),
    status: Joi.string().trim().max(40).allow(null, "").optional(),
    label: Joi.string().trim().max(180).allow(null, "").optional(),
    ambiguous: Joi.boolean().optional(),
    confirmed: Joi.boolean().optional(),
    type: Joi.string().trim().max(64).allow(null, "").optional(),
  })
    .unknown(true)
    .required(),
});
