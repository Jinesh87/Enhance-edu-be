import Joi from "joi";

export const listClassesQuerySchema = Joi.object({
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(500),
  search: Joi.string().trim().max(120).allow("", null),
  year: Joi.number().integer().min(2000).max(2100),
  yearLevel: Joi.string().trim().max(80).allow("", null),
  term: Joi.string().trim().max(120).allow("", null),
  summaryOnly: Joi.boolean().truthy("true").falsy("false"),
  /** Edit timetable: unique weekday slots only (no full term session dump). */
  templateOnly: Joi.boolean().truthy("true").falsy("false"),
});

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
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(500).default(10),
  status: Joi.string()
    .valid("ALL", "UPCOMING", "LIVE", "ENDED", "SCHEDULED")
    .default("ALL"),
  search: Joi.string().trim().max(120).allow("", null),
  startDate: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .allow("", null),
  endDate: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .allow("", null),
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
  gracePeriodMinutes: Joi.number().integer().min(0).max(480),
  classId: Joi.string().uuid(), // for weekly-slot rows that have no real session yet
  isWeeklySlot: Joi.boolean(),
})
  .or("startAt", "endAt", "room", "classroomId", "teacherId", "gracePeriodMinutes")
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

export const bulkDeleteSessionsSchema = Joi.object({
  ids: Joi.array().items(Joi.string().uuid()).min(1).max(100).required(),
});

export const bulkReplaceClassSchema = Joi.object({
  termId: Joi.string().uuid().required(),
  gracePeriodMinutes: Joi.number().integer().min(0).max(480).default(25),
  classes: Joi.array()
    .items(createClassSchema)
    .min(0)
    .max(500)
    .required(),
});
