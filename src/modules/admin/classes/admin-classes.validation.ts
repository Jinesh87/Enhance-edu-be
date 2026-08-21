import Joi from "joi";

export const createClassSchema = Joi.object({
  name: Joi.string().trim().max(120).allow(null, ""),
  code: Joi.string().trim().min(2).max(60).required(),
  classroomId: Joi.string().uuid().allow(null, ""),
  room: Joi.string().trim().max(80).allow("", null),
  subject: Joi.string().trim().max(120).allow(null, ""),
  lesson: Joi.string().trim().max(60).allow(null, ""),
  dayTime: Joi.string().trim().max(100).allow(null, ""),
  timeZone: Joi.string().trim().max(80).allow(null, ""),
  capacity: Joi.number().integer().min(1).max(500).default(20),
  contentGroup: Joi.string().trim().max(120).allow(null, ""),
  term: Joi.string().trim().max(120).allow(null, ""),
  termId: Joi.string().uuid().allow(null, ""),
  teacherId: Joi.string().uuid().allow(null, ""),
  gracePeriodMinutes: Joi.number().integer().min(0).max(480).default(25),
});

export const updateClassSchema = Joi.object({
  name: Joi.string().trim().max(120).allow(null, ""),
  code: Joi.string().trim().min(2).max(60),
  classroomId: Joi.string().uuid().allow(null),
  room: Joi.string().trim().max(80),
  subject: Joi.string().trim().max(120).allow(null, ""),
  lesson: Joi.string().trim().max(60).allow(null, ""),
  dayTime: Joi.string().trim().max(100).allow(null, ""),
  timeZone: Joi.string().trim().max(80).allow(null, ""),
  capacity: Joi.number().integer().min(1).max(500),
  contentGroup: Joi.string().trim().max(120).allow(null, ""),
  term: Joi.string().trim().max(120).allow(null, ""),
  termId: Joi.string().uuid().allow(null, ""),
  teacherId: Joi.string().uuid().allow(null, ""),
  gracePeriodMinutes: Joi.number().integer().min(0).max(480),
});

export const classIdParamsSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

export const bulkReplaceClassSchema = Joi.object({
  termId: Joi.string().uuid().required(),
  gracePeriodMinutes: Joi.number().integer().min(0).max(480).default(25),
  classes: Joi.array()
    .items(createClassSchema)
    .min(1)
    .max(500)
    .required(),
});
