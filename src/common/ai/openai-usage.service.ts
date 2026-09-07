import { AppDataSource } from "../../config/data-source.js";
import { logger } from "../../config/logger.js";
import {
  OpenAiUsageLog,
  type OpenAiUsageOperation,
  type OpenAiUsageStatus,
} from "../../entities/OpenAiUsageLog.js";

export type OpenAiCallContext = {
  feature: string;
  userId?: string | null;
  metadata?: Record<string, unknown>;
  /** Number of input items (e.g. embedding batch size). */
  requestCount?: number;
};

/** Approximate OpenAI list prices (USD per 1M tokens). Update as pricing changes. */
const MODEL_PRICING: Record<
  string,
  { inputPerMillion: number; outputPerMillion: number }
> = {
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10 },
  "text-embedding-3-small": { inputPerMillion: 0.02, outputPerMillion: 0 },
  "text-embedding-3-large": { inputPerMillion: 0.13, outputPerMillion: 0 },
};

export function estimateCostUsd(params: {
  model: string;
  promptTokens: number;
  completionTokens: number;
}): number | null {
  const pricing = MODEL_PRICING[params.model];
  if (!pricing) return null;
  const input =
    (Math.max(0, params.promptTokens) / 1_000_000) * pricing.inputPerMillion;
  const output =
    (Math.max(0, params.completionTokens) / 1_000_000) *
    pricing.outputPerMillion;
  return Number((input + output).toFixed(6));
}

export type RecordOpenAiUsageInput = {
  feature: string;
  operation: OpenAiUsageOperation;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  status?: OpenAiUsageStatus;
  errorMessage?: string | null;
  userId?: string | null;
  requestCount?: number | null;
  metadata?: Record<string, unknown> | null;
};

export async function recordOpenAiUsage(
  input: RecordOpenAiUsageInput,
): Promise<void> {
  try {
    if (!AppDataSource.isInitialized) return;

    const promptTokens = Math.max(0, input.promptTokens ?? 0);
    const completionTokens = Math.max(0, input.completionTokens ?? 0);
    const totalTokens =
      input.totalTokens ?? promptTokens + completionTokens;
    const estimated =
      input.status === "error"
        ? null
        : estimateCostUsd({
            model: input.model,
            promptTokens,
            completionTokens,
          });

    const repo = AppDataSource.getRepository(OpenAiUsageLog);
    await repo.save(
      repo.create({
        feature: input.feature.slice(0, 80),
        operation: input.operation,
        model: input.model.slice(0, 80),
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCostUsd:
          estimated === null ? null : estimated.toFixed(6),
        status: input.status ?? "success",
        errorMessage: input.errorMessage?.slice(0, 255) ?? null,
        userId: input.userId ?? null,
        requestCount: input.requestCount ?? null,
        metadata: input.metadata ?? null,
      }),
    );
  } catch (error) {
    logger.warn({ err: error }, "Failed to record OpenAI usage log");
  }
}

export type OpenAiUsageSummary = {
  requestCount: number;
  successCount: number;
  errorCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  byFeature: Array<{
    feature: string;
    requestCount: number;
    totalTokens: number;
    estimatedCostUsd: number;
  }>;
  byModel: Array<{
    model: string;
    requestCount: number;
    totalTokens: number;
    estimatedCostUsd: number;
  }>;
};

export type OpenAiUsageListItem = {
  id: string;
  feature: string;
  operation: OpenAiUsageOperation;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  status: OpenAiUsageStatus;
  errorMessage: string | null;
  userId: string | null;
  userName: string | null;
  requestCount: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

function parseCost(value: string | null): number {
  if (!value) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export class OpenAiUsageService {
  private get repo() {
    return AppDataSource.getRepository(OpenAiUsageLog);
  }

  async getSummary(filters: {
    from?: Date;
    to?: Date;
  }): Promise<OpenAiUsageSummary> {
    const qb = this.repo.createQueryBuilder("log");
    if (filters.from) {
      qb.andWhere("log.createdAt >= :from", { from: filters.from });
    }
    if (filters.to) {
      qb.andWhere("log.createdAt <= :to", { to: filters.to });
    }

    const rows = await qb.getMany();

    const byFeature = new Map<
      string,
      { requestCount: number; totalTokens: number; estimatedCostUsd: number }
    >();
    const byModel = new Map<
      string,
      { requestCount: number; totalTokens: number; estimatedCostUsd: number }
    >();

    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    let estimatedCostUsd = 0;
    let successCount = 0;
    let errorCount = 0;

    for (const row of rows) {
      const cost = parseCost(row.estimatedCostUsd);
      promptTokens += row.promptTokens;
      completionTokens += row.completionTokens;
      totalTokens += row.totalTokens;
      estimatedCostUsd += cost;
      if (row.status === "error") errorCount += 1;
      else successCount += 1;

      const feature = byFeature.get(row.feature) ?? {
        requestCount: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      };
      feature.requestCount += 1;
      feature.totalTokens += row.totalTokens;
      feature.estimatedCostUsd += cost;
      byFeature.set(row.feature, feature);

      const model = byModel.get(row.model) ?? {
        requestCount: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      };
      model.requestCount += 1;
      model.totalTokens += row.totalTokens;
      model.estimatedCostUsd += cost;
      byModel.set(row.model, model);
    }

    return {
      requestCount: rows.length,
      successCount,
      errorCount,
      promptTokens,
      completionTokens,
      totalTokens,
      estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)),
      byFeature: Array.from(byFeature.entries())
        .map(([feature, stats]) => ({
          feature,
          ...stats,
          estimatedCostUsd: Number(stats.estimatedCostUsd.toFixed(6)),
        }))
        .sort((a, b) => b.totalTokens - a.totalTokens),
      byModel: Array.from(byModel.entries())
        .map(([model, stats]) => ({
          model,
          ...stats,
          estimatedCostUsd: Number(stats.estimatedCostUsd.toFixed(6)),
        }))
        .sort((a, b) => b.totalTokens - a.totalTokens),
    };
  }

  async list(filters: {
    from?: Date;
    to?: Date;
    feature?: string;
    status?: OpenAiUsageStatus;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));

    const qb = this.repo
      .createQueryBuilder("log")
      .leftJoinAndSelect("log.user", "user")
      .orderBy("log.createdAt", "DESC")
      .skip((page - 1) * limit)
      .take(limit);

    if (filters.from) {
      qb.andWhere("log.createdAt >= :from", { from: filters.from });
    }
    if (filters.to) {
      qb.andWhere("log.createdAt <= :to", { to: filters.to });
    }
    if (filters.feature?.trim()) {
      qb.andWhere("log.feature = :feature", {
        feature: filters.feature.trim(),
      });
    }
    if (filters.status) {
      qb.andWhere("log.status = :status", { status: filters.status });
    }

    const [rows, total] = await qb.getManyAndCount();

    const items: OpenAiUsageListItem[] = rows.map((row) => ({
      id: row.id,
      feature: row.feature,
      operation: row.operation,
      model: row.model,
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
      totalTokens: row.totalTokens,
      estimatedCostUsd: row.estimatedCostUsd
        ? Number(row.estimatedCostUsd)
        : null,
      status: row.status,
      errorMessage: row.errorMessage,
      userId: row.userId,
      userName: row.user?.fullName ?? null,
      requestCount: row.requestCount,
      metadata: row.metadata,
      createdAt: row.createdAt.toISOString(),
    }));

    return { items, total, page, limit };
  }
}

export const openAiUsageService = new OpenAiUsageService();
