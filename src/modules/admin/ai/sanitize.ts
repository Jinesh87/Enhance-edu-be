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
    re: /\b(?:password|api[_-]?key|secret|token|bearer|jwt)\s*[:=]\s*\S+/gi,
    replace: "[REDACTED_SECRET]",
  },
  {
    re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replace: "[REDACTED_EMAIL]",
  },
];

/** Exact keys (alphanumeric-normalised) never forwarded to the LLM. */
const SENSITIVE_KEY_EXACT = new Set([
  "email",
  "mobile",
  "phone",
  "telephone",
  "phonenumber",
  "address",
  "street",
  "suburb",
  "city",
  "postcode",
  "postalcode",
  "dob",
  "dateofbirth",
  "birthdate",
  "guardianemail",
  "guardianphone",
  "guardianmobile",
  "guardiancontact",
  "cookie",
  "cookies",
  "authorization",
  "credential",
  "credentials",
  "apikey",
  "apisecret",
  "accesskey",
  "secretkey",
  "privatekey",
  "refreshtoken",
  "accesstoken",
  "resettoken",
  "sessiontoken",
  "jwttoken",
  "passwordhash",
  "hashedpassword",
  "password",
  "bankaccount",
  "accountnumber",
  "bsb",
  "iban",
  "swift",
  "cardnumber",
  "cvv",
  "cvc",
  "fee",
  "fees",
  "feeamount",
  "balance",
  "payment",
  "invoice",
  "before",
  "after",
  "smtp",
  "connectionstring",
  "databaseurl",
]);

/** Substring matches on normalised keys — keep narrow to avoid stripping safe fields. */
const SENSITIVE_KEY_INCLUDES = [
  "password",
  "aadhaar",
  "aadhar",
  "secret",
  "apikey",
  "credential",
  "cookie",
  "authorization",
  "privatekey",
  "refreshtoken",
  "accesstoken",
  "resettoken",
  "sessiontoken",
  "connectionstring",
  "databaseurl",
  "bankaccount",
  "cardnumber",
];

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (SENSITIVE_KEY_EXACT.has(lower)) return true;
  if (SENSITIVE_KEY_INCLUDES.some((part) => lower.includes(part))) return true;
  // Phone / email / fee variants (e.g. studentEmail, homePhone, tuitionFee)
  if (/(^|.)(email|phone|mobile|telephone)$/.test(lower)) return true;
  if (lower.endsWith("fee") || lower.endsWith("fees")) return true;
  return false;
}

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
      if (isSensitiveKey(key)) continue;
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
