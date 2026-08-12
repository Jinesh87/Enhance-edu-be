import Joi from "joi";
import {
  EMPLOYMENT_TYPES,
  INVITABLE_ROLES,
  UserRole,
  UserStatus,
} from "../../common/constants/roles.js";

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
