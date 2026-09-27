import type { LogEntry, LogLevel } from "./types";

type Subscriber = {
  clientIdFilter: string | null;
  send: (entry: LogEntry) => void;
};

export type SnapshotOptions = {
  /** null/undefined = all streams; string = only logs with that clientId */
  clientId?: string | null;
  /** Exclusive: return entries newer than this id. Unknown/evicted ids start from the oldest retained entry. */
  sinceId?: string;
  /** Only logs at this level (normalized). */
  level?: string;
  /** Max entries to return (default 200). */
  limit?: number;
};

const DEFAULT_BUFFER_SIZE = 500;
const DEFAULT_SNAPSHOT_LIMIT = 200;

/**
 * In-memory pub/sub for ephemeral logs. One instance per Node process (Dokku web dyno).
 * Uses `globalThis` so Next.js dev HMR does not reset state on every reload.
 *
 * Retention: a bounded in-memory ring buffer (LOGVIEW_BUFFER_SIZE, default 500)
 * keeps the most recent entries so reconnecting viewers and polling agents can
 * catch up. Memory only — nothing survives a process restart.
 */
class LogBroker {
  private readonly subscribers = new Set<Subscriber>();
  private readonly buffer: LogEntry[] = [];
  private readonly maxBufferSize: number;

  constructor() {
    const raw = process.env.LOGVIEW_BUFFER_SIZE;
    const parsed =
      raw !== undefined && raw !== "" ? Number.parseInt(raw, 10) : NaN;
    this.maxBufferSize =
      Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_BUFFER_SIZE;
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

    if (this.maxBufferSize > 0) {
      this.buffer.push(full);
      if (this.buffer.length > this.maxBufferSize) this.buffer.shift();
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

  /** Whether an entry id is still retained in the buffer (false = evicted or unknown). */
  hasId(id: string): boolean {
    return this.buffer.some((e) => e.id === id);
  }

  /**
   * Recent entries from the ring buffer, oldest-first.
   */
  snapshot({
    clientId = null,
    sinceId,
    level,
    limit = DEFAULT_SNAPSHOT_LIMIT,
  }: SnapshotOptions = {}): LogEntry[] {
    if (this.maxBufferSize === 0) return [];

    let start = 0;
    if (sinceId) {
      const idx = this.buffer.findIndex((e) => e.id === sinceId);
      start = idx === -1 ? 0 : idx + 1;
    }

    const wantedLevel = level ? normalizeLevel(level) : undefined;
    const out: LogEntry[] = [];
    for (let i = start; i < this.buffer.length; i++) {
      const e = this.buffer[i];
      if (clientId !== null && e.clientId !== clientId) continue;
      if (wantedLevel !== undefined && e.level !== wantedLevel) continue;
      out.push(e);
      if (out.length >= limit) break;
    }
    return out;
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

  /**
   * Subscribe plus the backlog the new subscriber missed. The backlog snapshot is
   * taken and the subscriber registered in the same synchronous call, so no entry
   * can slip between the two — send `backlog` before live events and the stream is
   * gap-free. `append` is synchronous, so callers that enqueue the backlog
   * immediately after this returns (still synchronously) see no interleaving.
   */
  subscribeWithBacklog(
    clientIdFilter: string | null,
    send: (entry: LogEntry) => void,
  ): { unsubscribe: () => void; backlog: LogEntry[] } {
    const backlog = this.snapshot({
      clientId: clientIdFilter,
      limit: this.maxBufferSize,
    });
    const unsubscribe = this.subscribe(clientIdFilter, send);
    return { unsubscribe, backlog };
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
