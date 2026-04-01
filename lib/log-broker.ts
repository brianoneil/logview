import type { LogEntry, LogLevel } from "./types";

const DEFAULT_MAX_BUFFER = 5_000;

type Subscriber = {
  clientIdFilter: string | null;
  send: (entry: LogEntry) => void;
};

/**
 * In-memory pub/sub for ephemeral logs. One instance per Node process (Dokku web dyno).
 * Uses `globalThis` so Next.js dev HMR does not reset state on every reload.
 */
class LogBroker {
  private buffer: LogEntry[] = [];
  private readonly subscribers = new Set<Subscriber>();
  private readonly maxBuffer: number;

  constructor(maxBuffer = DEFAULT_MAX_BUFFER) {
    this.maxBuffer = maxBuffer;
  }

  append(entry: Omit<LogEntry, "id" | "ts"> & { id?: string; ts?: string }): LogEntry {
    const full: LogEntry = {
      id: entry.id ?? crypto.randomUUID(),
      ts: entry.ts ?? new Date().toISOString(),
      level: entry.level ?? "info",
      message: entry.message,
      ...(entry.clientId !== undefined && entry.clientId !== ""
        ? { clientId: entry.clientId }
        : {}),
    };

    this.buffer.push(full);
    if (this.buffer.length > this.maxBuffer) {
      this.buffer = this.buffer.slice(this.buffer.length - this.maxBuffer);
    }

    for (const sub of this.subscribers) {
      if (
        sub.clientIdFilter === null ||
        sub.clientIdFilter === full.clientId
      ) {
        try {
          sub.send(full);
        } catch {
          this.subscribers.delete(sub);
        }
      }
    }

    return full;
  }

  /**
   * Register a subscriber. Immediately replays the current buffer (filtered).
   * @param clientIdFilter null = all streams; string = only logs with that clientId
   */
  subscribe(clientIdFilter: string | null, send: (entry: LogEntry) => void): () => void {
    const sub: Subscriber = { clientIdFilter, send };
    this.subscribers.add(sub);

    for (const e of this.buffer) {
      if (
        clientIdFilter === null ||
        clientIdFilter === e.clientId
      ) {
        try {
          send(e);
        } catch {
          this.subscribers.delete(sub);
          return () => this.subscribers.delete(sub);
        }
      }
    }

    return () => {
      this.subscribers.delete(sub);
    };
  }
}

const g = globalThis as unknown as { __logviewBroker?: LogBroker };

export function getLogBroker(): LogBroker {
  if (!g.__logviewBroker) {
    g.__logviewBroker = new LogBroker();
  }
  return g.__logviewBroker;
}

export function normalizeLevel(level: string | undefined): LogLevel {
  if (!level) return "info";
  const l = level.toLowerCase();
  if (l === "debug" || l === "info" || l === "warn" || l === "error") return l;
  return level;
}
