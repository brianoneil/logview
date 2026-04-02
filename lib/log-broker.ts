import type { LogEntry, LogLevel } from "./types";

type Subscriber = {
  clientIdFilter: string | null;
  send: (entry: LogEntry) => void;
};

/**
 * In-memory pub/sub for ephemeral logs. One instance per Node process (Dokku web dyno).
 * Uses `globalThis` so Next.js dev HMR does not reset state on every reload.
 *
 * No retention: subscribers only receive logs that arrive after they connect (live tail).
 */
class LogBroker {
  private readonly subscribers = new Set<Subscriber>();

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
   * Live updates only — no history sent on connect.
   * @param clientIdFilter null = all streams; string = only logs with that clientId
   */
  subscribe(clientIdFilter: string | null, send: (entry: LogEntry) => void): () => void {
    const sub: Subscriber = { clientIdFilter, send };
    this.subscribers.add(sub);

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
