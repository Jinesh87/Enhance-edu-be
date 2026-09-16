import Joi from "joi";

export const reportQuerySchema = Joi.object({
  dateFrom: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
  academicYearId: Joi.string().uuid().optional(),
  termId: Joi.string().uuid().optional(),
  yearLevelId: Joi.string().uuid().optional(),
  subjectId: Joi.string().max(120).optional(),
  teacherId: Joi.string().uuid().optional(),
  touchPoint: Joi.string().valid("first", "last").optional(),
  threshold: Joi.number().min(1).max(100).optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  sortBy: Joi.string().max(40).optional(),
  sortDir: Joi.string().valid("ASC", "DESC", "asc", "desc").default("DESC"),
});

export type ReportQueryInput = {
  dateFrom?: string;
  dateTo?: string;
  academicYearId?: string;
  termId?: string;
  yearLevelId?: string;
  subjectId?: string;
  teacherId?: string;
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
