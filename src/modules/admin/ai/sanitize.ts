const SENSITIVE_PATTERNS: Array<{ re: RegExp; replace: string }> = [
  {
    re: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    replace: "[REDACTED_ID]",
  },
  {
    re: /\b(?:\d[ -]*?){13,19}\b/g,
    replace: "[REDACTED_CARD]",
  },
  {
    re: /\b(?:password|api[_-]?key|secret|token)\s*[:=]\s*\S+/gi,
    replace: "[REDACTED_SECRET]",
  },
];

export function sanitizeAdminAiText(input: string, maxChars: number): string {
  let text = input.replace(/\0/g, "").trim();
  for (const rule of SENSITIVE_PATTERNS) {
    text = text.replace(rule.re, rule.replace);
  }
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
  }
  return text;
}

export function sanitizeToolPayload(
  value: unknown,
  depth = 0,
): unknown {
  if (depth > 6) return "[truncated]";
  if (value == null) return value;
  if (typeof value === "string") {
    return sanitizeAdminAiText(value, 2000);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeToolPayload(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      if (
        lower.includes("password") ||
        lower.includes("aadhaar") ||
        lower.includes("token") ||
        lower.includes("secret") ||
        lower.includes("apiKey".toLowerCase()) ||
        lower === "mobile" ||
        lower === "email" ||
        lower === "address"
      ) {
        continue;
      }
      out[key] = sanitizeToolPayload(nested, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function previewForSidebar(content: string): string {
  const cleaned = content.replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 120);
}
