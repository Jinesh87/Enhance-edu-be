import Joi from "joi";

const actions = [
  "CREATED",
  "EDITED",
  "DELETED",
  "APPROVED",
  "EXPORTED",
  "DENIED",
];

export const listAuditQuerySchema = Joi.object({
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
  actor: Joi.string().trim().max(160).allow(""),
  recordType: Joi.string().trim().max(40).allow(""),
  record: Joi.string().trim().max(240).allow(""),
  action: Joi.string()
    .valid(...actions)
    .allow(""),
  from: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .allow(""),
  to: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .allow(""),
  search: Joi.string().trim().max(240).allow(""),
});
