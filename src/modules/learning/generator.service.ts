import Joi from "joi";
import type {
  LearningDifficulty,
  LearningGenerationType,
} from "../../common/constants/learning.js";
import {
  CHAT_MODEL,
  createChatCompletion,
} from "../../common/ai/openai-client.js";
import { AppError } from "../../common/errors/AppError.js";

const flashcardsSchema = Joi.object({
  title: Joi.string().trim().min(1).max(200).required(),
  items: Joi.array()
    .items(
      Joi.object({
        front: Joi.string().trim().min(1).max(2000).required(),
        back: Joi.string().trim().min(1).max(4000).required(),
      }),
    )
    .min(1)
    .max(30)
    .required(),
}).required();

const quizSchema = Joi.object({
  title: Joi.string().trim().min(1).max(200).required(),
  items: Joi.array()
    .items(
      Joi.object({
        question: Joi.string().trim().min(1).max(2000).required(),
        options: Joi.array()
          .items(Joi.string().trim().min(1).max(500))
          .min(2)
          .max(6)
          .required(),
        correctAnswer: Joi.number().integer().min(0).required(),
        explanation: Joi.string().trim().allow("").max(4000).optional(),
      }).custom((value, helpers) => {
        const options = value.options as string[];
        const unique = new Set(options.map((o) => o.toLowerCase()));
        if (unique.size !== options.length) {
          return helpers.error("any.invalid");
        }
        if (value.correctAnswer < 0 || value.correctAnswer >= options.length) {
          return helpers.error("any.invalid");
        }
        return value;
      }),
    )
    .min(1)
    .max(30)
    .required(),
}).required();

const revisionSchema = Joi.object({
  title: Joi.string().trim().min(1).max(200).required(),
  items: Joi.array()
    .items(
      Joi.object({
        question: Joi.string().trim().min(1).max(2000).required(),
        answer: Joi.string().trim().min(1).max(4000).required(),
      }),
    )
    .min(1)
    .max(30)
    .required(),
}).required();

export type GeneratedFlashcards = {
  title: string;
  items: Array<{ front: string; back: string }>;
};

export type GeneratedQuiz = {
  title: string;
  items: Array<{
    question: string;
    options: string[];
    correctAnswer: number;
    explanation?: string;
  }>;
};

export type GeneratedRevision = {
  title: string;
  items: Array<{ question: string; answer: string }>;
};

function systemPrompt(type: LearningGenerationType): string {
  const base = `You are an education content generator for a tutoring platform.
Generate accurate learning content ONLY from the provided source material.
Return valid JSON only. Do not wrap in markdown. Do not invent facts not supported by the source.
Match the requested difficulty and item count as closely as possible.`;

  if (type === "flashcards") {
    return `${base}
Schema:
{"title": string, "items": [{"front": string, "back": string}]}
Front = concise prompt/term. Back = clear answer/definition.`;
  }
  if (type === "quiz") {
    return `${base}
Schema:
{"title": string, "items": [{"question": string, "options": [string,string,string,string], "correctAnswer": number, "explanation": string}]}
Single-choice MCQ only. Prefer exactly 4 distinct options. correctAnswer is the 0-based index of the correct option.`;
  }
  return `${base}
Schema:
{"title": string, "items": [{"question": string, "answer": string}]}
Revision questions for self-study with model answers.`;
}

function userPrompt(input: {
  type: LearningGenerationType;
  difficulty: LearningDifficulty;
  itemCount: number;
  subjectName: string;
  className: string;
  sourceText: string;
  preferredTitle?: string;
}): string {
  const titleLine = input.preferredTitle?.trim()
    ? `Set title (keep this exact title in the JSON "title" field): ${input.preferredTitle.trim()}`
    : "Set title: invent a short clear title from the source";

  return `Subject: ${input.subjectName}
Class: ${input.className}
Difficulty: ${input.difficulty}
Item count: ${input.itemCount}
Generation type: ${input.type}
${titleLine}

SOURCE MATERIAL:
${input.sourceText}`;
}

function parseJsonContent(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new AppError(
      502,
      "Unable to generate learning content. Please try again.",
      "AI_INVALID_JSON",
    );
  }
}

export async function generateLearningContent(input: {
  type: LearningGenerationType;
  difficulty: LearningDifficulty;
  itemCount: number;
  subjectName: string;
  className: string;
  sourceText: string;
  userId: string;
  learningSetId: string;
  preferredTitle?: string;
}): Promise<GeneratedFlashcards | GeneratedQuiz | GeneratedRevision> {
  const completion = await createChatCompletion(
    {
      model: CHAT_MODEL,
      temperature: 0.3,
      max_tokens: 4000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt(input.type) },
        {
          role: "user",
          content: userPrompt({
            type: input.type,
            difficulty: input.difficulty,
            itemCount: input.itemCount,
            subjectName: input.subjectName,
            className: input.className,
            sourceText: input.sourceText,
            preferredTitle: input.preferredTitle,
          }),
        },
      ],
    },
    {
      feature: "learning_generate",
      userId: input.userId,
      metadata: {
        generationType: input.type,
        learningSetId: input.learningSetId,
        difficulty: input.difficulty,
        itemCount: input.itemCount,
      },
    },
  );

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    throw new AppError(
      502,
      "Unable to generate learning content. Please try again.",
      "AI_EMPTY_RESPONSE",
    );
  }

  let parsed: unknown;
  try {
    parsed = parseJsonContent(raw);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      502,
      "Unable to generate learning content. Please try again.",
      "AI_INVALID_JSON",
    );
  }

  const schema =
    input.type === "flashcards"
      ? flashcardsSchema
      : input.type === "quiz"
        ? quizSchema
        : revisionSchema;

  const { error, value } = schema.validate(parsed, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    throw new AppError(
      502,
      "Unable to generate learning content. Please try again.",
      "AI_SCHEMA_INVALID",
      { details: error.details.map((d) => d.message) },
    );
  }

  return value as GeneratedFlashcards | GeneratedQuiz | GeneratedRevision;
}
