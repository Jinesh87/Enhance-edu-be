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
  term: Joi.string().trim().max(120).allow(""),
  subject: Joi.string().trim().max(120).allow(""),
  year: Joi.number().integer().min(2000).max(2100),
  yearGroup: Joi.string().trim().max(80).allow(""),
  teacherId: uuid.allow(""),
  fromDate: Joi.string().pattern(datePattern).allow(""),
  toDate: Joi.string().pattern(datePattern).allow(""),
  includeStudents: Joi.boolean().truthy("true").falsy("false"),
  /** Table/calendar list — display fields only, no students/notes. */
  summaryOnly: Joi.boolean().truthy("true").falsy("false"),
  kind: Joi.string().valid("SCHOOL", "ENTRANCE", "ALL").allow(""),
  status: Joi.string()
    .valid(...ASSESSMENT_STATUSES, "ACTIVE", "OPEN")
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
  scheduleType: Joi.string().valid("SESSION", "FULL_DAY").default("SESSION"),
  classId: uuid.allow(null, ""),
  termId: uuid.required(),
  subject: Joi.string().trim().min(1).max(120).required(),
  yearGroup: Joi.string().trim().min(1).max(80).required(),
  assessmentDate: Joi.string().pattern(datePattern).required(),
  startTime: Joi.when("scheduleType", {
    is: "FULL_DAY",
    then: Joi.string().pattern(timePattern).default("00:00"),
    otherwise: Joi.string().pattern(timePattern).required(),
  }),
  durationMinutes: Joi.when("scheduleType", {
    is: "FULL_DAY",
    then: Joi.number().integer().valid(1440).default(1440),
    otherwise: Joi.number().integer().min(15).max(480).required(),
  }),
  classroomId: uuid.allow(null, ""),
  room: Joi.string().trim().max(80).allow("", null),
  teacherId: uuid.allow(null, ""),
  totalMarks: marksField.allow(null),
  cutOffMarks: marksField.allow(null),
  autoMarking: Joi.boolean().default(false),
  notes: Joi.string().trim().max(2000).allow("", null),
  studentIds: Joi.array().items(uuid).max(200),
  timeZone: Joi.string().trim().max(80).allow(null, ""),
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
  }, "marks bounds")
  .messages({
    "any.custom": "{{#message}}",
  });

export const updateAssessmentSchema = Joi.object({
  name: Joi.string().trim().min(1).max(160),
  kind: Joi.string().valid("SCHOOL", "ENTRANCE"),
  scheduleType: Joi.string().valid("SESSION", "FULL_DAY"),
  classId: uuid.allow(null, ""),
  termId: uuid,
  subject: Joi.string().trim().min(1).max(120),
  yearGroup: Joi.string().trim().min(1).max(80),
  assessmentDate: Joi.string().pattern(datePattern),
  startTime: Joi.when("scheduleType", {
    is: "FULL_DAY",
    then: Joi.string().pattern(timePattern).default("00:00"),
    otherwise: Joi.string().pattern(timePattern),
  }),
  durationMinutes: Joi.when("scheduleType", {
    is: "FULL_DAY",
    then: Joi.number().integer().valid(1440).default(1440),
    otherwise: Joi.number().integer().min(15).max(480),
  }),
  classroomId: uuid.allow(null, ""),
  room: Joi.string().trim().max(80).allow("", null),
  teacherId: uuid.allow(null, ""),
  totalMarks: marksField.allow(null),
  cutOffMarks: marksField.allow(null),
  autoMarking: Joi.boolean(),
  notes: Joi.string().trim().max(2000).allow("", null),
  studentIds: Joi.array().items(uuid).max(200),
  timeZone: Joi.string().trim().max(80).allow(null, ""),
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
