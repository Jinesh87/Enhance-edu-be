import Joi from "joi";

const uuid = Joi.string().uuid();
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const createTeacherHomeworkSchema = Joi.object({
  title: Joi.string().trim().min(1).max(160).required(),
  description: Joi.string().trim().max(5000).allow("", null),
  termId: uuid.required(),
  subjectId: uuid.required(),
  teacherId: uuid.allow("", null).optional(),
  yearGroup: Joi.string().trim().min(1).max(80).required(),
  dueDate: Joi.string().pattern(datePattern).required(),
  maxMarks: Joi.number().min(1).max(1000).allow(null).optional(),
});

export const updateTeacherHomeworkSchema = Joi.object({
  title: Joi.string().trim().min(1).max(160).optional(),
  description: Joi.string().trim().max(5000).allow("", null).optional(),
  teacherId: uuid.allow("", null).optional(),
  dueDate: Joi.string().pattern(datePattern).optional(),
  maxMarks: Joi.number().min(1).max(1000).allow(null).optional(),
  removeAttachmentIds: Joi.alternatives()
    .try(
      Joi.array().items(uuid),
      uuid.custom((val) => [val]),
      Joi.string().custom((val) => {
        try {
          const parsed = JSON.parse(val);
          return Array.isArray(parsed) ? parsed : [val];
        } catch {
          return val ? [val] : [];
        }
      }),
    )
    .optional(),
});

export const gradeTeacherHomeworkSubmissionSchema = Joi.object({
  marks: Joi.number().min(0).max(1000).allow(null).optional(),
  maxMarks: Joi.number().min(1).max(1000).allow(null).optional(),
  feedback: Joi.string().trim().max(5000).allow("", null).optional(),
  isCompleted: Joi.boolean().optional(),
});
