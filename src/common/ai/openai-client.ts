import OpenAI from "openai";
import { settingsService } from "../../modules/settings/settings.service.js";
import { AppError } from "../errors/AppError.js";
import {
  recordOpenAiUsage,
  type OpenAiCallContext,
} from "./openai-usage.service.js";

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

export async function embedTexts(
  texts: string[],
  context?: OpenAiCallContext,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const feature = context?.feature ?? "embedding";
  const client = await getOpenAIClient();

  try {
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: texts,
    });

    const usage = response.usage;
    await recordOpenAiUsage({
      feature,
      operation: "embedding",
      model: EMBEDDING_MODEL,
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: 0,
      totalTokens: usage?.total_tokens ?? usage?.prompt_tokens ?? 0,
      status: "success",
      userId: context?.userId,
      requestCount: texts.length,
      metadata: context?.metadata ?? null,
    });

    return response.data
      .sort((a, b) => a.index - b.index)
      .map((row) => row.embedding);
  } catch (error) {
    await recordOpenAiUsage({
      feature,
      operation: "embedding",
      model: EMBEDDING_MODEL,
      status: "error",
      errorMessage:
        error instanceof Error ? error.message : "Embedding request failed",
      userId: context?.userId,
      requestCount: texts.length,
      metadata: context?.metadata ?? null,
    });
    throw error;
  }
}

export async function embedText(
  text: string,
  context?: OpenAiCallContext,
): Promise<number[]> {
  const [embedding] = await embedTexts([text], context);
  return embedding;
}

export async function createChatCompletion(
  params: {
    model?: string;
    temperature?: number;
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  },
  context?: OpenAiCallContext,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const model = params.model ?? CHAT_MODEL;
  const feature = context?.feature ?? "chat";
  const client = await getOpenAIClient();

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: params.temperature,
      messages: params.messages,
    });

    const usage = completion.usage;
    await recordOpenAiUsage({
      feature,
      operation: "chat",
      model,
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
      status: "success",
      userId: context?.userId,
      requestCount: 1,
      metadata: context?.metadata ?? null,
    });

    return completion;
  } catch (error) {
    await recordOpenAiUsage({
      feature,
      operation: "chat",
      model,
      status: "error",
      errorMessage:
        error instanceof Error ? error.message : "Chat completion failed",
      userId: context?.userId,
      requestCount: 1,
      metadata: context?.metadata ?? null,
    });
    throw error;
  }
}
