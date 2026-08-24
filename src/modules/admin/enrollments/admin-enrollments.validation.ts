import Joi from "joi";

const newGuardianSchema = Joi.object({
  fullName: Joi.string().trim().min(2).max(120).required(),
  preferredName: Joi.string().trim().max(80).allow(null, ""),
  email: Joi.string().trim().email().max(255).required(),
  mobile: Joi.string().trim().max(30).allow(null, ""),
});

const studentLoginSchema = Joi.object({
  username: Joi.string()
    .trim()
    .min(3)
    .max(50)
    .pattern(/^[a-zA-Z0-9._-]+$/)
    .required()
    .messages({
      "string.pattern.base":
        "Username may only contain letters, numbers, dots, underscores, and hyphens",
    }),
  password: Joi.string().min(8).max(128).required(),
});

export const inviteEnrollmentSchema = Joi.object({
  guardianId: Joi.string().uuid(),
  guardian: newGuardianSchema,
  student: Joi.object({
    fullName: Joi.string().trim().min(2).max(120).required(),
    preferredName: Joi.string().trim().max(80).allow(null, ""),
    dateOfBirth: Joi.string()
      .trim()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .allow(null, "")
      .messages({
        "string.pattern.base": "Date of birth must be in YYYY-MM-DD format",
      }),
    yearLevel: Joi.number().integer().min(1).max(13).required(),
  }).required(),
  enrollment: Joi.object({
    termId: Joi.string().uuid().required(),
    subjectIds: Joi.array().items(Joi.string().uuid()).min(1).required(),
    fee: Joi.number().min(0).precision(2).required(),
  }).required(),
  studentLogin: studentLoginSchema.optional(),
})
  .xor("guardianId", "guardian")
  .messages({
    "object.missing": "Provide either guardianId or guardian details",
    "object.xor": "Provide either guardianId or guardian details, not both",
  });

export const modifyEnrollmentSchema = Joi.object({
  student: Joi.object({
    fullName: Joi.string().trim().min(2).max(120).required(),
    preferredName: Joi.string().trim().max(80).allow(null, ""),
    dateOfBirth: Joi.string()
      .trim()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .allow(null, "")
      .messages({
        "string.pattern.base": "Date of birth must be in YYYY-MM-DD format",
      }),
    yearLevel: Joi.number().integer().min(1).max(13).required(),
  }).required(),
  enrollment: Joi.object({
    termId: Joi.string().uuid().required(),
    subjectIds: Joi.array().items(Joi.string().uuid()).min(1).required(),
    fee: Joi.number().min(0).precision(2).required(),
  }).required(),
});

export const enrollmentIdParamsSchema = Joi.object({
  id: Joi.string().uuid().required(),
});
