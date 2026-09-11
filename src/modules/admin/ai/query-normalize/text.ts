/**
 * Shared text helpers for Admin AI query normalization.
 * Keep section-specific aliases in the registry — not here.
 */

const DEFAULT_NOISE = new Set([
  "a",
  "all",
  "an",
  "and",
  "any",
  "detail",
  "details",
  "display",
  "every",
  "export",
  "find",
  "for",
  "full",
  "generate",
  "get",
  "give",
  "info",
  "information",
  "list",
  "me",
  "of",
  "pdf",
  "please",
  "prepare",
  "profile",
  "profiles",
  "query",
  "record",
  "records",
  "report",
  "reports",
  "show",
  "the",
  "their",
  "them",
  "these",
  "those",
  "view",
]);

export function normalizeQueryText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripQueryNoise(
  value: string,
  extraNoise: Iterable<string> = [],
): string | null {
  const noise = new Set(DEFAULT_NOISE);
  for (const word of extraNoise) {
    const normalized = normalizeQueryText(word);
    if (normalized) noise.add(normalized);
  }
  const kept = normalizeQueryText(value)
    .split(" ")
    .filter((token) => token && !noise.has(token));
  return kept.length ? kept.join(" ") : null;
}

export function compactKey(value: string): string {
  return normalizeQueryText(value).replace(/\s+/g, "_").toUpperCase();
}
