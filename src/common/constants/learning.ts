export const LEARNING_GENERATION_TYPES = [
  "flashcards",
  "quiz",
  "revision",
] as const;
export type LearningGenerationType = (typeof LEARNING_GENERATION_TYPES)[number];

export const LEARNING_DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type LearningDifficulty = (typeof LEARNING_DIFFICULTIES)[number];

export const LEARNING_SET_STATUSES = ["DRAFT", "PUBLISHED"] as const;
export type LearningSetStatus = (typeof LEARNING_SET_STATUSES)[number];

export const FLASHCARD_PROGRESS_STATUSES = ["KNOWN", "NEEDS_REVIEW"] as const;
export type FlashcardProgressStatus =
  (typeof FLASHCARD_PROGRESS_STATUSES)[number];

export const LEARNING_MAX_ITEMS = 20;
export const LEARNING_MIN_ITEMS = 3;
export const LEARNING_DEFAULT_ITEMS = 8;
export const LEARNING_MAX_PDF_BYTES = 15 * 1024 * 1024;
export const LEARNING_MAX_SOURCE_CHARS = 35_000;
export const LEARNING_MIN_EXTRACTED_CHARS = 80;
