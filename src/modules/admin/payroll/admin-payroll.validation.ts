import Joi from "joi";

export const payrollPeriodQuerySchema = Joi.object({
  from: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const payrollTeacherParamsSchema = Joi.object({
  teacherUserId: Joi.string().uuid().required(),
});

export const upsertPayrollConfigSchema = Joi.object({
  teacherUserId: Joi.string().uuid().required(),
  payBasis: Joi.string()
    .valid("HOURLY", "DAILY", "WEEKLY", "MONTHLY")
    .required(),
  rate: Joi.number().min(0).max(1_000_000).required(),
  currency: Joi.string().trim().uppercase().max(8).optional(),
  isActive: Joi.boolean().optional(),
  effectiveFrom: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const staffParamsSchema = Joi.object({
  staffUserId: Joi.string().uuid().required(),
});

export const staffEntryParamsSchema = Joi.object({
  entryId: Joi.string().uuid().required(),
});

export const upsertStaffConfigSchema = Joi.object({
  staffUserId: Joi.string().uuid().required(),
  payBasis: Joi.string().valid("HOURLY", "DAILY").required(),
  rate: Joi.number().min(0).max(1_000_000).required(),
  currency: Joi.string().trim().uppercase().max(8).optional(),
  isActive: Joi.boolean().optional(),
  effectiveFrom: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const staffWorkEntrySchema = Joi.object({
  workDate: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .required(),
  quantity: Joi.number().greater(0).max(24).required(),
  notes: Joi.string().trim().max(1000).allow("", null).optional(),
});
