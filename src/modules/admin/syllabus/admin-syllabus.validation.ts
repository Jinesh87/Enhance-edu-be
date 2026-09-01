import Joi from "joi";

const syllabusSkillSchema = Joi.object({
  name: Joi.string().trim().min(1).max(120).required(),
  weightage: Joi.number().min(0).allow(null),
  description: Joi.string().trim().max(2000).allow(null, ""),
});

export const syllabusIdParamsSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

export const syllabusDocumentParamsSchema = Joi.object({
  id: Joi.string().uuid().required(),
  documentId: Joi.string().uuid().required(),
});

export const listSyllabusQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(25),
  search: Joi.string().trim().max(120).allow("", null),
  subjectId: Joi.string().uuid().allow("", null),
  academicYearId: Joi.string().uuid().allow("", null),
  yearLevelId: Joi.string().uuid().allow("", null),
});

export const createSyllabusSchema = Joi.object({
  subjectId: Joi.string().uuid().required(),
  academicYearId: Joi.string().uuid().required(),
  yearLevelId: Joi.string().uuid().required(),
  title: Joi.string().trim().min(1).max(200).required(),
  overview: Joi.string().trim().max(20000).allow(null, ""),
  skills: Joi.array().items(syllabusSkillSchema).max(100).default([]),
});

export const updateSyllabusSchema = Joi.object({
  subjectId: Joi.string().uuid(),
  academicYearId: Joi.string().uuid(),
  yearLevelId: Joi.string().uuid(),
  title: Joi.string().trim().min(1).max(200),
  overview: Joi.string().trim().max(20000).allow(null, ""),
  skills: Joi.array().items(syllabusSkillSchema).max(100),
}).min(1);
