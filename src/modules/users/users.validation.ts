import Joi from "joi";
import {
  EMPLOYMENT_TYPES,
  INVITABLE_ROLES,
  UserRole,
  UserStatus,
} from "../../common/constants/roles.js";

const enrollmentStudentSchema = Joi.object({
  fullName: Joi.string().trim().min(2).max(120).required(),
  preferredName: Joi.string().trim().max(80).allow(null, ""),
  dateOfBirth: Joi.string()
    .trim()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .allow(null, "")
    .messages({
      "string.pattern.base": "Date of birth must be in YYYY-MM-DD format",
    }),
  yearLevel: Joi.number().integer().min(1).max(13).allow(null),
});

const enrollmentDetailsSchema = Joi.object({
  termId: Joi.string().uuid().required(),
  subjectIds: Joi.array().items(Joi.string().uuid()).min(1).required(),
  fee: Joi.number().min(0).precision(2).required(),
});

export const createUserSchema = Joi.object({
  fullName: Joi.string().trim().min(2).max(120).required(),
  preferredName: Joi.string().trim().max(80).allow(null, ""),
  email: Joi.string().trim().email().max(255).required(),
  mobile: Joi.string().trim().max(30).allow(null, ""),
  role: Joi.string()
    .valid(...INVITABLE_ROLES)
    .required(),
  employmentType: Joi.string()
    .valid(...EMPLOYMENT_TYPES)
    .allow(null)
    .when("role", {
      is: Joi.valid(UserRole.STAFF, UserRole.SUPER_ADMIN),
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),
  student: enrollmentStudentSchema.when("role", {
    is: UserRole.GUARDIAN,
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
  enrollment: enrollmentDetailsSchema.when("role", {
    is: UserRole.GUARDIAN,
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
});

export const updateUserSchema = Joi.object({
  fullName: Joi.string().trim().min(2).max(120),
  preferredName: Joi.string().trim().max(80).allow(null, ""),
  email: Joi.string().trim().email().max(255),
  mobile: Joi.string().trim().max(30).allow(null, ""),
  role: Joi.string().valid(...INVITABLE_ROLES),
  employmentType: Joi.string()
    .valid(...EMPLOYMENT_TYPES)
    .allow(null),
  status: Joi.string().valid(UserStatus.ACTIVE, UserStatus.DEACTIVATED),
})
  .min(1)
  .messages({
    "object.min": "At least one field is required",
  });

export const listUsersQuerySchema = Joi.object({
  status: Joi.string().valid(...Object.values(UserStatus)),
  role: Joi.string().valid(...Object.values(UserRole)),
});
