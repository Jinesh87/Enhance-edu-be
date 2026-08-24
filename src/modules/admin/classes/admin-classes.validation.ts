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
  /** When set with teacherId, only these upcoming session IDs inherit the new teacher. */
  applyTeacherToSessionIds: Joi.array().items(Joi.string().uuid()).optional(),
  gracePeriodMinutes: Joi.number().integer().min(0).max(480),
});

export const classIdParamsSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

export const groupSessionsQuerySchema = Joi.object({
  subject: Joi.string().trim().min(1).max(120).required(),
  term: Joi.string().trim().min(1).max(200).required(),
});

export const sessionIdParamsSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

export const updateSessionSchema = Joi.object({
  startAt: Joi.string().isoDate(),
  endAt: Joi.string().isoDate(),
  room: Joi.string().trim().max(80).allow(null, ""),
  classroomId: Joi.string().uuid().allow(null, ""),
  teacherId: Joi.string().uuid().allow(null, ""),
  classId: Joi.string().uuid(), // for weekly-slot rows that have no real session yet
  isWeeklySlot: Joi.boolean(),
})
  .or("startAt", "endAt", "room", "classroomId", "teacherId")
  .custom((value, helpers) => {
    if (value.startAt && value.endAt) {
      const start = new Date(value.startAt).getTime();
      const end = new Date(value.endAt).getTime();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return helpers.error("any.custom", {
          message: "endAt must be after startAt",
        });
      }
    }
    return value;
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
