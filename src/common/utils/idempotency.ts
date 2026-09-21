/**
 * Durable Idempotency-Key cache (Redis) with in-memory fallback.
 * Survives multi-instance deploys when Redis is available.
 */
import { redis } from "../../config/redis.js";
import { logger } from "../../config/logger.js";

export type IdempotencyCacheEntry = {
  expiresAt: number;
  status: number;
  body: unknown;
};

const TTL_MS = 24 * 60 * 60 * 1000;
const TTL_SEC = Math.floor(TTL_MS / 1000);
const KEY_PREFIX = "idempotency:v1:";

const memoryStore = new Map<string, IdempotencyCacheEntry>();

function pruneMemory(): void {
  const now = Date.now();
  for (const [key, value] of memoryStore) {
    if (value.expiresAt <= now) memoryStore.delete(key);
  }
}

function memoryLookup(key: string): IdempotencyCacheEntry | null {
  pruneMemory();
  const hit = memoryStore.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    memoryStore.delete(key);
    return null;
  }
  return hit;
}

function memoryStoreEntry(
  key: string,
  status: number,
  body: unknown,
): void {
  pruneMemory();
  memoryStore.set(key, {
    expiresAt: Date.now() + TTL_MS,
    status,
    body,
  });
}

function redisReady(): boolean {
  return redis.status === "ready";
}

export function readIdempotencyKey(req: {
  get?: (name: string) => string | undefined;
  body?: { clientRequestId?: string };
}): string | undefined {
  const header =
    req.get?.("Idempotency-Key")?.trim() ||
    req.get?.("idempotency-key")?.trim();
  if (header) return header;
  return req.body?.clientRequestId?.trim() || undefined;
}

export async function idempotencyLookup(
  key: string | undefined,
): Promise<IdempotencyCacheEntry | null> {
  if (!key?.trim()) return null;
  const normalized = key.trim();

  if (redisReady()) {
    try {
      const raw = await redis.get(`${KEY_PREFIX}${normalized}`);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          status: number;
          body: unknown;
        };
        if (typeof parsed.status === "number") {
          return {
            expiresAt: Date.now() + TTL_MS,
            status: parsed.status,
            body: parsed.body,
          };
        }
      }
    } catch (error) {
      logger.warn({ err: error }, "Idempotency Redis lookup failed; using memory");
    }
  }

  return memoryLookup(normalized);
}

export async function idempotencyStore(
  key: string | undefined,
  status: number,
  body: unknown,
): Promise<void> {
  if (!key?.trim()) return;
  const normalized = key.trim();
  const payload = JSON.stringify({ status, body });

  memoryStoreEntry(normalized, status, body);

  if (!redisReady()) return;
  try {
    await redis.set(`${KEY_PREFIX}${normalized}`, payload, "EX", TTL_SEC);
  } catch (error) {
    logger.warn({ err: error }, "Idempotency Redis store failed; memory kept");
  }
}

/** Test helper — clear memory fallback only. */
export function __resetIdempotencyMemoryForTests(): void {
  memoryStore.clear();
}
