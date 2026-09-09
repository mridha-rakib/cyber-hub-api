const sensitiveKey =
  /password|token|authorization|cookie|apikey|secret|credential|databaseurl|connectionstring|privatekey|cardnumber|cvv/i;

export function sanitizeText(text: string): string {
  return text
    .replace(
      /\b(?:postgres(?:ql)?|mongodb(?:\+srv)?|redis|https?):\/\/[^\s/@]+:[^\s/@]+@[^\s]+/gi,
      "[REDACTED_URL]",
    )
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(
      /((?:password(?:Hash)?|(?:access|refresh)?Token|api[_-]?key|(?:payment|webhook)?Secret|authorization|cookie)\s*[=:]\s*)[^\s,;]+/gi,
      "$1[REDACTED]",
    );
}

// Bound traversal and do not invoke custom toJSON methods on arbitrary objects.
export function sanitizeLog(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (typeof value === "string") return sanitizeText(value);
  if (value === null || typeof value !== "object") return value;
  if (depth > 12) return "[TRUNCATED]";
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  try {
    if (value instanceof Error)
      return sanitizeLog(
        { ...value, name: value.name, message: value.message, stack: value.stack },
        seen,
        depth + 1,
      );
    if (Array.isArray(value)) return value.map((entry) => sanitizeLog(entry, seen, depth + 1));
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        sensitiveKey.test(key.replace(/[-_]/g, ""))
          ? "[REDACTED]"
          : sanitizeLog(entry, seen, depth + 1),
      ]),
    );
  } finally {
    seen.delete(value);
  }
}
