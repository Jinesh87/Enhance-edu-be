import Joi from "joi";
import { EnquiryNurtureState } from "../../../common/constants/enquiry.js";

const uuid = Joi.string().uuid();

export const listEnquiriesQuerySchema = Joi.object({
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
  search: Joi.string().trim().max(240).allow(""),
  stageId: Joi.string().uuid().allow(""),
  ownerUserId: Joi.string().uuid().allow(""),
  sourceId: Joi.string().uuid().allow(""),
  status: Joi.string().valid("open", "lost", "converted", "all").allow(""),
  idleDays: Joi.number().integer().min(0),
  yearLevel: Joi.number().integer().min(1).max(13),
  termId: uuid.allow(""),
  subject: Joi.string().trim().max(120).allow(""),
  sort: Joi.string().valid(
    "updated",
    "idle",
    "score",
    "student",
    "created",
  ),
  view: Joi.string().valid("list", "board").allow(""),
});

export const enquiryIdParamsSchema = Joi.object({
  id: uuid.required(),
});

export const createEnquirySchema = Joi.object({
  studentFullName: Joi.string().trim().max(120).allow(null, ""),
  yearLevel: Joi.number().integer().min(1).max(13).required(),
  school: Joi.string().trim().max(160).allow(null, ""),
  subjectOfInterest: Joi.string().trim().min(1).max(120).required(),
  guardianFullName: Joi.string().trim().min(2).max(120).required(),
  guardianEmail: Joi.string().trim().email().max(255).required(),
  guardianMobile: Joi.string().trim().max(30).allow(null, ""),
  sourceId: uuid.required(),
  ownerUserId: uuid.allow(null, ""),
  score: Joi.number().integer().min(0).max(100).allow(null),
});

export const updateEnquirySchema = Joi.object({
  studentFullName: Joi.string().trim().max(120).allow(null, ""),
  yearLevel: Joi.number().integer().min(1).max(13),
  school: Joi.string().trim().max(160).allow(null, ""),
  subjectOfInterest: Joi.string().trim().min(1).max(120),
  guardianFullName: Joi.string().trim().min(2).max(120),
  guardianEmail: Joi.string().trim().email().max(255),
  guardianMobile: Joi.string().trim().max(30).allow(null, ""),
  lastSourceId: uuid,
  ownerUserId: uuid.allow(null, ""),
  score: Joi.number().integer().min(0).max(100).allow(null),
  nurtureState: Joi.string().valid(...Object.values(EnquiryNurtureState)),
  trialClassName: Joi.string().trim().max(160).allow(null, ""),
  trialEndDate: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .allow(null, ""),
  examSession: Joi.string().trim().max(120).allow(null, ""),
  examThreshold: Joi.number().min(0).allow(null),
  examScriptReference: Joi.string().trim().max(120).allow(null, ""),
})
  .min(1)
  .messages({ "object.min": "At least one field is required" });

export const changeStageSchema = Joi.object({
  stageId: uuid.required(),
  lostReasonId: uuid.allow(null, ""),
  competitorId: uuid.allow(null, ""),
  competitorName: Joi.string().trim().max(120).allow(null, ""),
  note: Joi.string().trim().max(500).allow(null, ""),
});

export const bookTrialSchema = Joi.object({
  termId: uuid.required(),
  confirmed: Joi.boolean().required(),
});

export const trialAttendanceSchema = Joi.object({
  attended: Joi.boolean().required(),
});

export const examResultSchema = Joi.object({
  examSession: Joi.string().trim().max(120).allow(null, ""),
  examMark: Joi.number().min(0).required(),
  examThreshold: Joi.number().min(0).required(),
  examMarkedBy: Joi.string().trim().max(120).required(),
  examScriptReference: Joi.string().trim().max(120).allow(null, ""),
});

export const convertEnquirySchema = Joi.object({
  guardianId: uuid.allow(null, ""),
  guardian: Joi.object({
    fullName: Joi.string().trim().min(2).max(120).required(),
    preferredName: Joi.string().trim().max(80).allow(null, ""),
    email: Joi.string().trim().email().max(255).required(),
    mobile: Joi.string().trim().max(30).allow(null, ""),
  }),
  student: Joi.object({
    fullName: Joi.string().trim().min(2).max(120).required(),
    preferredName: Joi.string().trim().max(80).allow(null, ""),
    dateOfBirth: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .allow(null, ""),
    yearLevel: Joi.number().integer().min(1).max(13).allow(null),
  }).required(),
  enrollment: Joi.object({
    termId: uuid.required(),
    subjectIds: Joi.array().items(uuid).min(1).required(),
    fee: Joi.number().min(0).precision(2).required(),
  }).required(),
}).or("guardianId", "guardian");

export const bulkEnquiriesSchema = Joi.object({
  ids: Joi.array().items(uuid).min(1).max(100).required(),
  ownerUserId: uuid.allow(null, ""),
  lastSourceId: uuid,
  stageId: uuid,
  lostReasonId: uuid.allow(null, ""),
  competitorId: uuid.allow(null, ""),
  competitorName: Joi.string().trim().max(120).allow(null, ""),
}).or("ownerUserId", "lastSourceId", "stageId");
