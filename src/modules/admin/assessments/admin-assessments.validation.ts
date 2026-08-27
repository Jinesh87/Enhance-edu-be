import Joi from "joi";
import { ASSESSMENT_STATUSES } from "../../../entities/Assessment.js";

const uuid = Joi.string().uuid();
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const listAssessmentsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
  search: Joi.string().trim().max(160).allow(""),
  termId: uuid.allow(""),
  subject: Joi.string().trim().max(120).allow(""),
  yearGroup: Joi.string().trim().max(80).allow(""),
  kind: Joi.string().valid("SCHOOL", "ENTRANCE", "ALL").allow(""),
  status: Joi.string()
    .valid(...ASSESSMENT_STATUSES, "ACTIVE")
    .allow(""),
});

export const assessmentIdParamsSchema = Joi.object({
  id: uuid.required(),
});

export const assessmentAttendeeParamsSchema = Joi.object({
  id: uuid.required(),
  studentId: uuid.required(),
});

export const assessmentAttendeeFileParamsSchema = Joi.object({
  id: uuid.required(),
  studentId: uuid.required(),
  fileId: uuid.required(),
});

const marksField = Joi.number().min(0).max(99999.99).precision(2);

export const markAttendeeSchema = Joi.object({
  mark: marksField.required(),
  markNotes: Joi.string().trim().max(2000).allow("", null),
});

export const createAssessmentSchema = Joi.object({
  name: Joi.string().trim().min(1).max(160).required(),
  kind: Joi.string().valid("SCHOOL", "ENTRANCE").default("SCHOOL"),
  classId: uuid.allow(null, ""),
  termId: uuid.required(),
  subject: Joi.string().trim().min(1).max(120).required(),
  yearGroup: Joi.string().trim().min(1).max(80).required(),
  assessmentDate: Joi.string().pattern(datePattern).required(),
  startTime: Joi.string().pattern(timePattern).required(),
  durationMinutes: Joi.number().integer().min(15).max(480).required(),
  classroomId: uuid.allow(null, ""),
  room: Joi.string().trim().max(80).allow("", null),
  teacherId: uuid.allow(null, ""),
  totalMarks: marksField.allow(null),
  cutOffMarks: marksField.allow(null),
  notes: Joi.string().trim().max(2000).allow("", null),
  studentIds: Joi.array().items(uuid).max(200),
})
  .when(Joi.object({ kind: Joi.valid("ENTRANCE") }).unknown(), {
    then: Joi.object({
      teacherId: uuid.required().messages({
        "any.required": "Teacher is required for entrance exams",
        "string.empty": "Teacher is required for entrance exams",
        "string.guid": "Teacher is required for entrance exams",
      }),
      totalMarks: marksField.required().messages({
        "any.required": "Total marks are required for entrance exams",
        "number.base": "Total marks are required for entrance exams",
      }),
      cutOffMarks: marksField.required().messages({
        "any.required": "Cut-off marks are required for entrance exams",
        "number.base": "Cut-off marks are required for entrance exams",
      }),
    }),
  })
  .custom((value, helpers) => {
    if (value.kind !== "ENTRANCE") return value;
    if (
      value.totalMarks != null &&
      value.cutOffMarks != null &&
      Number(value.cutOffMarks) > Number(value.totalMarks)
    ) {
      return helpers.error("any.custom", {
        message: "Cut-off marks cannot exceed total marks",
      });
    }
    return value;
  }, "entrance marks bounds")
  .messages({
    "any.custom": "{{#message}}",
  });

export const updateAssessmentSchema = Joi.object({
  name: Joi.string().trim().min(1).max(160),
  kind: Joi.string().valid("SCHOOL", "ENTRANCE"),
  classId: uuid.allow(null, ""),
  termId: uuid,
  subject: Joi.string().trim().min(1).max(120),
  yearGroup: Joi.string().trim().min(1).max(80),
  assessmentDate: Joi.string().pattern(datePattern),
  startTime: Joi.string().pattern(timePattern),
  durationMinutes: Joi.number().integer().min(15).max(480),
  classroomId: uuid.allow(null, ""),
  room: Joi.string().trim().max(80).allow("", null),
  teacherId: uuid.allow(null, ""),
  totalMarks: marksField.allow(null),
  cutOffMarks: marksField.allow(null),
  notes: Joi.string().trim().max(2000).allow("", null),
  studentIds: Joi.array().items(uuid).max(200),
})
  .min(1)
  .custom((value, helpers) => {
    if (
      value.totalMarks != null &&
      value.cutOffMarks != null &&
      Number(value.cutOffMarks) > Number(value.totalMarks)
    ) {
      return helpers.error("any.custom", {
        message: "Cut-off marks cannot exceed total marks",
      });
    }
    return value;
  }, "entrance marks bounds")
  .messages({
    "any.custom": "{{#message}}",
  });
