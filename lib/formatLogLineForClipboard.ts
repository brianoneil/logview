import type { LogEntry } from "@/lib/types";
import {
  prettyPrintJson,
  tryParseStructuredJsonMessage,
} from "@/lib/parseLogJsonMessage";
import { stripAnsi } from "@/lib/stripAnsi";

/**
 * Plain-text block suitable for pasting into docs or chat: ISO time, level,
 * client, correlation id, then the message. Structured JSON log lines use the
 * same pretty-print (`JSON.stringify(…, null, 2)`) as the expanded row UI.
 */
export function formatLogEntryForClipboard(entry: LogEntry): string {
  const client = entry.clientId?.trim() || "—";
  const parsed = tryParseStructuredJsonMessage(entry.message);
  const message =
    parsed !== null ? prettyPrintJson(parsed) : stripAnsi(entry.message);
  return [
    `Time:   ${entry.ts}`,
    `Level:  ${entry.level}`,
    `Client: ${client}`,
    `Id:     ${entry.id}`,
    `Message:\n${message}`,
  ].join("\n");
}
