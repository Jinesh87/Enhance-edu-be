import Joi from "joi";

export const exportStudentAttendanceSchema = Joi.object({
  studentId: Joi.string().uuid().required(),
  academicYearId: Joi.string().uuid().required(),
  termId: Joi.string().uuid().required(),
  subjectId: Joi.alternatives()
    .try(Joi.string().valid("all"), Joi.string().uuid())
    .optional()
    .default("all"),
});
