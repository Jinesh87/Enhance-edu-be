import { normalizeQueryText } from "./text.js";

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (curr[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j] ?? 0;
  }
  return prev[b.length] ?? 0;
}

function maxDistanceFor(length: number): number {
  if (length <= 4) return 1;
  if (length <= 8) return 2;
  return 3;
}

/**
 * Fuzzy-match a free-text value against allowlisted aliases.
 * Returns the canonical value for the best alias hit, or null.
 */
export function fuzzyMatchCanonical(
  input: string,
  aliasToCanonical: Record<string, string>,
): string | null {
  const needle = normalizeQueryText(input);
  if (!needle) return null;

  if (aliasToCanonical[needle]) return aliasToCanonical[needle]!;

  // Substring / includes for multi-word aliases.
  let bestIncludes: { canonical: string; aliasLen: number } | null = null;
  for (const [alias, canonical] of Object.entries(aliasToCanonical)) {
    if (!alias) continue;
    if (needle.includes(alias) || alias.includes(needle)) {
      if (!bestIncludes || alias.length > bestIncludes.aliasLen) {
        bestIncludes = { canonical, aliasLen: alias.length };
      }
    }
  }
  if (bestIncludes && bestIncludes.aliasLen >= 3) {
    return bestIncludes.canonical;
  }

  let best: { canonical: string; distance: number } | null = null;
  for (const [alias, canonical] of Object.entries(aliasToCanonical)) {
    if (!alias) continue;
    const distance = levenshtein(needle, alias);
    const allowed = maxDistanceFor(Math.min(needle.length, alias.length));
    if (distance > allowed) continue;
    if (!best || distance < best.distance) {
      best = { canonical, distance };
    }
  }
  return best?.canonical ?? null;
}
