import Joi from "joi";

export const reportQuerySchema = Joi.object({
  dateFrom: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
  academicYear: Joi.alternatives().try(Joi.number().integer(), Joi.string()).optional(),
  academicYearId: Joi.string().uuid().optional(),
  yearGroup: Joi.string().max(80).optional(),
  yearLevelId: Joi.string().uuid().optional(),
  termId: Joi.string().uuid().optional(),
  subjectId: Joi.string().max(120).optional(),
  teacherId: Joi.string().uuid().optional(),
  touchPoint: Joi.string().valid("first", "last").optional(),
  threshold: Joi.number().min(0).max(100).optional(),
  studentId: Joi.string().uuid().optional(),
  statusFilter: Joi.string().max(60).allow("").optional(),
  search: Joi.string().max(100).allow("").optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(10000).default(20),
  sortBy: Joi.string().max(40).optional(),
  sortDir: Joi.string().valid("ASC", "DESC", "asc", "desc").default("DESC"),
});

export type ReportQueryInput = {
  dateFrom?: string;
  dateTo?: string;
  academicYear?: number | string;
  academicYearId?: string;
  yearGroup?: string;
  yearLevelId?: string;
  termId?: string;
  subjectId?: string;
  teacherId?: string;
  studentId?: string;
  statusFilter?: string;
  search?: string;
  touchPoint?: "first" | "last";
  threshold?: number;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortDir?: "ASC" | "DESC" | "asc" | "desc";
};

export const reportExportSchema = Joi.object({
  tab: Joi.string().valid("attendance", "enquiries", "classes", "assessments", "homework").required(),
  filters: reportQuerySchema.default({}),
});

export type ReportExportInput = {
  tab: "attendance" | "enquiries" | "classes" | "assessments" | "homework";
  filters: ReportQueryInput;
};

export const notifyGuardianSchema = Joi.object({
  studentId: Joi.string().uuid().required(),
  channels: Joi.array().items(Joi.string().valid("email", "sms")).min(1).required(),
  subject: Joi.string().max(200).optional().default("Official Attendance Notice"),
  message: Joi.string().max(2500).required(),
  guardianEmail: Joi.string().email().optional().allow("", null),
  guardianPhone: Joi.string().max(30).optional().allow("", null),
});

export type NotifyGuardianInput = {
  studentId: string;
  channels: ("email" | "sms")[];
  subject?: string;
  message: string;
  guardianEmail?: string | null;
  guardianPhone?: string | null;
};
