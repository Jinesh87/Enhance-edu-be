import Joi from "joi";

const classroomBodySchema = Joi.object({
  name: Joi.string().trim().min(1).max(120).required(),
  code: Joi.string().trim().min(1).max(40).required(),
  capacity: Joi.number().integer().min(1).max(500).allow(null).optional(),
  isActive: Joi.boolean().optional(),
});

export const createClassroomSchema = classroomBodySchema;

export const updateClassroomSchema = classroomBodySchema;

export const classroomIdParamsSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

export const listClassroomsQuerySchema = Joi.object({
  isActive: Joi.boolean().truthy("true").falsy("false").optional(),
});
