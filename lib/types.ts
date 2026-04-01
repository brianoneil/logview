/** Normalized log level (ingest may send any string; we normalize for display). */
export type LogLevel = "debug" | "info" | "warn" | "error" | string;

export interface LogEntry {
  id: string;
  ts: string;
  level: LogLevel;
  message: string;
  clientId?: string;
}
