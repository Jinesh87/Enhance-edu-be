import OpenAI from "openai";
import { settingsService } from "../../modules/settings/settings.service.js";
import { AppError } from "../errors/AppError.js";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const CHAT_MODEL = "gpt-4o-mini";
export const EMBEDDING_DIMENSIONS = 1536;

export async function getOpenAIClient(): Promise<OpenAI> {
  const apiKey = await settingsService.getOpenAiApiKey();
  if (!apiKey) {
    throw new AppError(
      503,
      "OpenAI is not configured. Ask an admin to set the API key in Settings.",
      "OPENAI_NOT_CONFIGURED",
    );
  }
  return new OpenAI({ apiKey });
}

export function embeddingToPgVector(values: number[]): string {
  return `[${values.join(",")}]`;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const client = await getOpenAIClient();
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });
  return response.data
    .sort((a, b) => a.index - b.index)
    .map((row) => row.embedding);
}

export async function embedText(text: string): Promise<number[]> {
  const [embedding] = await embedTexts([text]);
  return embedding;
}
