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

type ChatCompletionParams = {
  model?: string;
  temperature?: number;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  tool_choice?: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
  max_tokens?: number;
  response_format?: OpenAI.Chat.Completions.ChatCompletionCreateParams["response_format"];
};

function chatTimeoutMs(feature: string) {
  return feature === "admin_ai_chat" || feature === "learning_generate"
    ? 90_000
    : 60_000;
}

export async function createChatCompletion(
  params: ChatCompletionParams,
  context?: OpenAiCallContext,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const model = params.model ?? CHAT_MODEL;
  const feature = context?.feature ?? "chat";
  const client = await getOpenAIClient();
  const timeoutMs = chatTimeoutMs(feature);

  try {
    const completion = await client.chat.completions.create(
      {
        model,
        temperature: params.temperature,
        messages: params.messages,
        tools: params.tools,
        tool_choice: params.tool_choice,
        max_tokens: params.max_tokens,
        response_format: params.response_format,
      },
      { timeout: timeoutMs },
    );

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

export type StreamedChatCompletion = {
  content: string;
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
  finishReason: string | null;
};

/**
 * Streams a chat completion. Content deltas are forwarded only while no
 * tool_calls have appeared (model usually returns one or the other).
 */
export async function streamChatCompletion(
  params: ChatCompletionParams,
  context?: OpenAiCallContext,
  options?: {
    signal?: AbortSignal;
    onDelta?: (text: string) => void;
  },
): Promise<StreamedChatCompletion> {
  const model = params.model ?? CHAT_MODEL;
  const feature = context?.feature ?? "chat";
  const client = await getOpenAIClient();
  const timeoutMs = chatTimeoutMs(feature);

  try {
    const stream = await client.chat.completions.create(
      {
        model,
        temperature: params.temperature,
        messages: params.messages,
        tools: params.tools,
        tool_choice: params.tool_choice,
        max_tokens: params.max_tokens,
        response_format: params.response_format,
        stream: true,
        stream_options: { include_usage: true },
      },
      { timeout: timeoutMs, signal: options?.signal },
    );

    let content = "";
    let finishReason: string | null = null;
    let usage: OpenAI.Completions.CompletionUsage | undefined;
    const toolCallParts = new Map<
      number,
      {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }
    >();

    for await (const chunk of stream) {
      if (options?.signal?.aborted) {
        break;
      }
      if (chunk.usage) {
        usage = chunk.usage;
      }
      const choice = chunk.choices[0];
      if (!choice) continue;
      if (choice.finish_reason) {
        finishReason = choice.finish_reason;
      }
      const delta = choice.delta;
      if (!delta) continue;

      if (delta.tool_calls?.length) {
        for (const part of delta.tool_calls) {
          const existing = toolCallParts.get(part.index) ?? {
            id: "",
            type: "function" as const,
            function: { name: "", arguments: "" },
          };
          if (part.id) existing.id = part.id;
          if (part.function?.name) {
            existing.function.name += part.function.name;
          }
          if (part.function?.arguments) {
            existing.function.arguments += part.function.arguments;
          }
          toolCallParts.set(part.index, existing);
        }
      }

      if (delta.content) {
        content += delta.content;
        if (toolCallParts.size === 0) {
          options?.onDelta?.(delta.content);
        }
      }
    }

    if (options?.signal?.aborted) {
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";
      throw abortError;
    }

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

    const toolCalls = [...toolCallParts.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, call]) => call);

    return { content, toolCalls, finishReason };
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") {
      throw error;
    }
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
