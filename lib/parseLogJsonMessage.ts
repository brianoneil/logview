import { stripAnsi } from "@/lib/stripAnsi";

/**
 * If the log line is a JSON object or array (optional ANSI wrapper), returns the parsed value.
 * Root primitives are not treated as “structured JSON” so normal lines are unchanged.
 */
export function tryParseStructuredJsonMessage(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const candidates =
    trimmed === stripAnsi(trimmed)
      ? [trimmed]
      : [trimmed, stripAnsi(trimmed)];

  for (const candidate of candidates) {
    const first = candidate[0];
    if (first !== "{" && first !== "[") continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed !== null && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

export function prettyPrintJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function oneLineJsonPreview(value: unknown, maxLen: number): string {
  const s = JSON.stringify(value);
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(1, maxLen - 1))}…`;
}
