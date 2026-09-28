import Joi from "joi";
import { AttendanceStatus } from "../../../entities/index.js";

export const MY_TASK_TABS = ["pending", "completed"] as const;
export type MyTaskTab = (typeof MY_TASK_TABS)[number];

export const CORRECTABLE_STATUSES = [
  AttendanceStatus.PRESENT,
  AttendanceStatus.LATE,
  AttendanceStatus.ABSENT,
  AttendanceStatus.EXCUSED,
] as const;
export type CorrectableStatus = (typeof CORRECTABLE_STATUSES)[number];

export const listMyTasksQuerySchema = Joi.object({
  tab: Joi.string()
    .valid(...MY_TASK_TABS)
    .default("pending"),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(10),
});

export const myTaskIdParamsSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

export const completeMyTaskSchema = Joi.object({
  status: Joi.string()
    .valid(...CORRECTABLE_STATUSES)
    .required(),
  reason: Joi.string().trim().min(1).max(255).required(),
});
