import Joi from "joi";
import {
  LEARNING_DEFAULT_ITEMS,
  LEARNING_DIFFICULTIES,
  LEARNING_GENERATION_TYPES,
  LEARNING_MAX_ITEMS,
  LEARNING_MIN_ITEMS,
} from "../../../common/constants/learning.js";

const uuid = Joi.string().uuid();

export const createLearningSetSchema = Joi.object({
  title: Joi.string().trim().min(1).max(160).required(),
  subjectId: uuid.required(),
  termId: uuid.required(),
  yearGroup: Joi.string().trim().min(1).max(80).required(),
  generationType: Joi.string()
    .valid(...LEARNING_GENERATION_TYPES)
    .required(),
  difficulty: Joi.string()
    .valid(...LEARNING_DIFFICULTIES)
    .default("medium"),
  itemCount: Joi.number()
    .integer()
    .min(LEARNING_MIN_ITEMS)
    .max(LEARNING_MAX_ITEMS)
    .default(LEARNING_DEFAULT_ITEMS),
  marksPerQuestion: Joi.number().min(0.5).max(100).default(1),
  forceOcr: Joi.boolean().truthy("true").falsy("false").default(false),
});

export const updateLearningSetSchema = Joi.object({
  title: Joi.string().trim().min(1).max(160).optional(),
  difficulty: Joi.string()
    .valid(...LEARNING_DIFFICULTIES)
    .optional(),
  itemCount: Joi.number()
    .integer()
    .min(LEARNING_MIN_ITEMS)
    .max(LEARNING_MAX_ITEMS)
    .optional(),
  marksPerQuestion: Joi.number().min(0.5).max(100).optional(),
}).min(1);

export const generateLearningSetSchema = Joi.object({
  forceOcr: Joi.boolean().truthy("true").falsy("false").default(false),
});

export const upsertFlashcardSchema = Joi.object({
  front: Joi.string().trim().min(1).max(2000).required(),
  back: Joi.string().trim().min(1).max(4000).required(),
  position: Joi.number().integer().min(0).optional(),
});

export const upsertQuizQuestionSchema = Joi.object({
  question: Joi.string().trim().min(1).max(2000).required(),
  explanation: Joi.string().trim().allow("", null).max(4000).optional(),
  options: Joi.array()
    .items(
      Joi.object({
        text: Joi.string().trim().min(1).max(500).required(),
        isCorrect: Joi.boolean().required(),
      }),
    )
    .min(2)
    .max(6)
    .required(),
  position: Joi.number().integer().min(0).optional(),
}).custom((value, helpers) => {
  const correct = value.options.filter(
    (o: { isCorrect: boolean }) => o.isCorrect,
  );
  if (correct.length !== 1) {
    return helpers.error("any.invalid");
  }
  const texts = value.options.map((o: { text: string }) =>
    o.text.trim().toLowerCase(),
  );
  if (new Set(texts).size !== texts.length) {
    return helpers.error("any.invalid");
  }
  return value;
});

export const upsertRevisionSchema = Joi.object({
  question: Joi.string().trim().min(1).max(2000).required(),
  answer: Joi.string().trim().min(1).max(4000).required(),
  position: Joi.number().integer().min(0).optional(),
});

export const updateFlashcardSchema = Joi.object({
  front: Joi.string().trim().min(1).max(2000).optional(),
  back: Joi.string().trim().min(1).max(4000).optional(),
  position: Joi.number().integer().min(0).optional(),
}).min(1);

export const updateRevisionSchema = Joi.object({
  question: Joi.string().trim().min(1).max(2000).optional(),
  answer: Joi.string().trim().min(1).max(4000).optional(),
  position: Joi.number().integer().min(0).optional(),
}).min(1);
