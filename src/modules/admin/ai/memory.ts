import { randomUUID } from "crypto";
import { AppError } from "../../../common/errors/AppError.js";
import { AppDataSource } from "../../../config/data-source.js";
import {
  AdminAiMemory,
  type AdminAiMemoryKind,
} from "../../../entities/AdminAiMemory.js";
import { writeAdminAiAudit } from "./audit.js";
import type { AdminAiActor } from "./authorization.js";
import { sanitizeAdminAiText } from "./sanitize.js";

export const MAX_ADMIN_AI_MEMORY_CHARS = 500;
export const MAX_ADMIN_AI_MEMORIES_PER_USER = 20;

const BLOCKED_MEMORY_RE =
  /\b(password|passwd|api[_-]?key|secret|token|bearer|jwt|ssn|bank|iban|bsb|credit\s*card|medical|diagnos|prescription|salary|fee\s*amount|blood\s*type)\b/i;

export function sanitizeMemoryContent(raw: string): string {
  const cleaned = sanitizeAdminAiText(raw, MAX_ADMIN_AI_MEMORY_CHARS).trim();
  if (cleaned.length < 3) {
    throw new AppError(
      400,
      "Memory must be a short preference (at least a few characters).",
      "ADMIN_AI_MEMORY_INVALID",
    );
  }
  if (BLOCKED_MEMORY_RE.test(cleaned) || /\[REDACTED_/i.test(cleaned)) {
    throw new AppError(
      400,
      "That memory cannot be saved because it looks sensitive.",
      "ADMIN_AI_MEMORY_SENSITIVE",
    );
  }
  return cleaned;
}

export function resolveMemoryKind(raw?: string | null): AdminAiMemoryKind {
  const value = raw?.trim().toLowerCase();
  if (value === "default_filter" || value === "default-filter") {
    return "default_filter";
  }
  return "preference";
}

export function formatAdminAiMemoryPromptBlock(
  memories: Array<{ kind: AdminAiMemoryKind; content: string }>,
): string | null {
  if (!memories.length) return null;
  const lines = memories.map(
    (memory) => `- [${memory.kind}] ${memory.content}`,
  );
  return [
    "Saved user preferences (scoped memory — lowest priority):",
    "Context priority (highest first):",
    "1) The user's current explicit request",
    "2) This conversation",
    "3) The memories below",
    "Never let memory silently override an explicit request (e.g. Year 11 wins over a Year 10 memory).",
    "Preference memories may personalise tone/prioritisation only — never as a hidden school-wide filter.",
    "default_filter memories may be used as defaults ONLY when the user did not specify a conflicting scope.",
    "Do not invent memories. Do not reveal memory IDs.",
    ...lines,
  ].join("\n");
}

function toMemoryDto(memory: AdminAiMemory) {
  return {
    id: memory.id,
    content: memory.content,
    kind: memory.kind,
    createdAt: memory.createdAt.toISOString(),
  };
}

export class AdminAiMemoryService {
  private readonly memories = AppDataSource.getRepository(AdminAiMemory);

  async listForUser(actor: AdminAiActor) {
    const rows = await this.memories.find({
      where: { ownerUserId: actor.id },
      order: { createdAt: "DESC" },
      take: MAX_ADMIN_AI_MEMORIES_PER_USER,
    });
    return { memories: rows.map(toMemoryDto) };
  }

  async listForPrompt(actor: AdminAiActor) {
    return this.memories.find({
      where: { ownerUserId: actor.id },
      order: { createdAt: "DESC" },
      take: MAX_ADMIN_AI_MEMORIES_PER_USER,
    });
  }

  async create(
    actor: AdminAiActor,
    input: { content: string; kind?: string | null },
  ) {
    const content = sanitizeMemoryContent(input.content);
    const kind = resolveMemoryKind(input.kind);

    const count = await this.memories.count({
      where: { ownerUserId: actor.id },
    });
    if (count >= MAX_ADMIN_AI_MEMORIES_PER_USER) {
      throw new AppError(
        400,
        "Memory limit reached. Delete an existing memory first.",
        "ADMIN_AI_MEMORY_LIMIT",
      );
    }

    const memory = await this.memories.save(
      this.memories.create({
        ownerUserId: actor.id,
        content,
        kind,
      }),
    );

    await writeAdminAiAudit({
      requestId: randomUUID().replace(/-/g, "").slice(0, 32),
      actor,
      eventType: "AI_MEMORY_CREATED",
      scopeMetadata: { memoryId: memory.id, kind: memory.kind },
      resultStatus: "ok",
    });

    return { memory: toMemoryDto(memory) };
  }

  async delete(actor: AdminAiActor, memoryId: string) {
    const memory = await this.memories.findOne({
      where: { id: memoryId, ownerUserId: actor.id },
    });
    if (!memory) {
      throw new AppError(404, "Memory not found", "ADMIN_AI_MEMORY_NOT_FOUND");
    }

    await this.memories.delete({ id: memory.id, ownerUserId: actor.id });

    await writeAdminAiAudit({
      requestId: randomUUID().replace(/-/g, "").slice(0, 32),
      actor,
      eventType: "AI_MEMORY_DELETED",
      scopeMetadata: { memoryId: memory.id, kind: memory.kind },
      resultStatus: "ok",
    });

    return { deletedId: memory.id };
  }
}

export const adminAiMemoryService = new AdminAiMemoryService();
