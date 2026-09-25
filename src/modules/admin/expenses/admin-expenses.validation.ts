import Joi from "joi";

const ymd = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/);
const amount = Joi.number().min(0).max(100_000_000);

export const expensePeriodQuerySchema = Joi.object({
  from: ymd.optional(),
  to: ymd.optional(),
});

export const expenseIdParamsSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

export const createFixedExpenseSchema = Joi.object({
  name: Joi.string().trim().min(1).max(160).required(),
  category: Joi.string().trim().min(1).max(60).required(),
  frequency: Joi.string()
    .valid("WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY")
    .required(),
  amount: amount.required(),
  startDate: ymd.required(),
  endDate: ymd.allow(null, "").optional(),
  currency: Joi.string().trim().uppercase().max(8).optional(),
  notes: Joi.string().trim().max(2000).allow(null, "").optional(),
});

export const updateFixedExpenseSchema = Joi.object({
  name: Joi.string().trim().min(1).max(160).optional(),
  category: Joi.string().trim().min(1).max(60).optional(),
  endDate: ymd.allow(null, "").optional(),
  notes: Joi.string().trim().max(2000).allow(null, "").optional(),
  amount: amount.optional(),
  effectiveFrom: ymd.optional(),
});

export const variableExpenseSchema = Joi.object({
  title: Joi.string().trim().min(1).max(160).required(),
  category: Joi.string().trim().min(1).max(60).required(),
  amount: amount.required(),
  expenseDate: ymd.required(),
  currency: Joi.string().trim().uppercase().max(8).optional(),
  notes: Joi.string().trim().max(2000).allow(null, "").optional(),
});
