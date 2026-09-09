import Joi from "joi";
import { FLASHCARD_PROGRESS_STATUSES } from "../../../common/constants/learning.js";

const uuid = Joi.string().uuid();

export const flashcardProgressSchema = Joi.object({
  status: Joi.string()
    .valid(...FLASHCARD_PROGRESS_STATUSES)
    .required(),
});

export const submitQuizAnswersSchema = Joi.object({
  answers: Joi.array()
    .items(
      Joi.object({
        questionId: uuid.required(),
        selectedOptionId: uuid.allow(null).required(),
      }),
    )
    .min(1)
    .required(),
});
