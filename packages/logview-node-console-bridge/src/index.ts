import { format } from "node:util";

export type LogLevelName = "debug" | "info" | "warn" | "error";

export type LogviewBridgeOptions = {
  /**
   * Logview origin only, e.g. `https://logview.example.com` or `http://127.0.0.1:3000`.
   * Ingest URL = baseUrl + ingestPath.
   */
  baseUrl: string;
  /** Default `/api/ingest`. */
  ingestPath?: string;
  /** When false, only local `console.*` runs (no network). Default true. */
  enabled?: boolean;
  /** Minimum severity forwarded to Logview. Default `info` (drops `debug` unless lowered). */
  minLevel?: LogLevelName;
  /** Optional tag in ingest payload (`clientId` field). */
  clientId?: string;
  /** Truncate `message` before POST. Default 100_000. */
  maxMessageChars?: number;
  /**
   * When set, enables buffered batch mode: logs are queued locally and flushed to
   * `/api/ingest/batch` (or `batchPath`) every `flushInterval` milliseconds instead of
   * one POST per log line. Useful for high-frequency logging or interval-based delivery.
   * Value is in milliseconds. Recommended range: 1_000–30_000.
   * The buffer is also flushed immediately on `dispose()`.
   */
  flushInterval?: number;
  /** Batch ingest path. Default `/api/ingest/batch`. Only used when `flushInterval` is set. */
  batchPath?: string;
  /** Max entries to buffer before triggering an early flush. Default 100. Only used when `flushInterval` is set. */
  maxBatchSize?: number;
};

export type LogviewBridgeHandle = {
  /** Restore original `console` methods. */
  dispose(): void;
};

const LEVEL_RANK: Record<LogLevelName, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function buildIngestUrl(baseUrl: string, ingestPath: string): string {
  const path = ingestPath.startsWith("/") ? ingestPath : `/${ingestPath}`;
  return `${normalizeBaseUrl(baseUrl)}${path}`;
}

function normalizeLevel(s: string | undefined, fallback: LogLevelName): LogLevelName {
  if (!s) return fallback;
  const x = s.toLowerCase() as LogLevelName;
  if (x === "debug" || x === "info" || x === "warn" || x === "error") return x;
  return fallback;
}

function shouldForwardLevel(level: LogLevelName, minLevel: LogLevelName): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[minLevel];
}

/**
 * Best-effort match to Node’s `console.*` formatting (`util.format`).
 */
function formatConsoleArgs(args: unknown[]): string {
  if (args.length === 0) return "";
  try {
    // `format` accepts the same variadic shapes as console
    return format(...(args as Parameters<typeof format>));
  } catch {
    return args
      .map((v) =>
        v instanceof Error ? (v.stack ?? v.message) : typeof v === "object" ? String(v) : String(v),
      )
      .join(" ");
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Read optional bridge settings from the environment (handy for servers).
 * - `LOGVIEW_BASE_URL` — origin
 * - `LOGVIEW_BRIDGE_ENABLED` — `1` / `true` / `yes` / `on` vs `0` / `false` / …
 * - `LOGVIEW_MIN_LEVEL` — `debug` | `info` | `warn` | `error`
 * - `LOGVIEW_CLIENT_ID` — passed as `clientId` on ingest
 * - `LOGVIEW_INGEST_PATH` — default `/api/ingest`
 * - `LOGVIEW_FLUSH_INTERVAL` — ms between batch flushes; enables batch mode when set
 * - `LOGVIEW_BATCH_PATH` — default `/api/ingest/batch`
 * - `LOGVIEW_MAX_BATCH_SIZE` — max buffered entries before early flush; default 100
 */
export function loadLogviewBridgeConfigFromEnv(): Partial<LogviewBridgeOptions> {
  const baseUrl = process.env.LOGVIEW_BASE_URL?.trim();
  const raw = process.env.LOGVIEW_BRIDGE_ENABLED?.trim().toLowerCase();
  let enabled: boolean | undefined;
  if (raw !== undefined && raw !== "") {
    enabled = ["1", "true", "yes", "on"].includes(raw);
  }
  const minLevel = process.env.LOGVIEW_MIN_LEVEL?.trim();
  const clientId = process.env.LOGVIEW_CLIENT_ID?.trim();
  const ingestPath = process.env.LOGVIEW_INGEST_PATH?.trim();
  const flushIntervalRaw = process.env.LOGVIEW_FLUSH_INTERVAL?.trim();
  const batchPath = process.env.LOGVIEW_BATCH_PATH?.trim();
  const maxBatchSizeRaw = process.env.LOGVIEW_MAX_BATCH_SIZE?.trim();

  const out: Partial<LogviewBridgeOptions> = {};
  if (baseUrl) out.baseUrl = baseUrl;
  if (enabled !== undefined) out.enabled = enabled;
  if (minLevel) out.minLevel = normalizeLevel(minLevel, "info");
  if (clientId) out.clientId = clientId;
  if (ingestPath) out.ingestPath = ingestPath;
  if (flushIntervalRaw) {
    const n = Number(flushIntervalRaw);
    if (Number.isFinite(n) && n > 0) out.flushInterval = n;
  }
  if (batchPath) out.batchPath = batchPath;
  if (maxBatchSizeRaw) {
    const n = Number(maxBatchSizeRaw);
    if (Number.isFinite(n) && n > 0) out.maxBatchSize = Math.floor(n);
  }
  return out;
}

type ResolvedBridgeOptions = {
  baseUrl: string;
  ingestPath: string;
  enabled: boolean;
  minLevel: LogLevelName;
  clientId?: string;
  maxMessageChars: number;
  flushInterval?: number;
  batchPath: string;
  maxBatchSize: number;
};

function resolveBridgeConfig(
  env: Partial<LogviewBridgeOptions>,
  opts: Partial<LogviewBridgeOptions>,
): ResolvedBridgeOptions {
  const baseUrl = (opts.baseUrl ?? env.baseUrl ?? "").trim();
  if (!baseUrl) {
    throw new Error(
      "createLogviewBridge: `baseUrl` is required (or set LOGVIEW_BASE_URL).",
    );
  }

  return {
    baseUrl,
    ingestPath: opts.ingestPath ?? env.ingestPath ?? "/api/ingest",
    enabled: opts.enabled ?? env.enabled ?? true,
    minLevel: normalizeLevel(opts.minLevel ?? env.minLevel, "info"),
    clientId: opts.clientId ?? env.clientId,
    maxMessageChars: opts.maxMessageChars ?? env.maxMessageChars ?? 100_000,
    flushInterval: opts.flushInterval ?? env.flushInterval,
    batchPath: opts.batchPath ?? env.batchPath ?? "/api/ingest/batch",
    maxBatchSize: opts.maxBatchSize ?? env.maxBatchSize ?? 100,
  };
}

function forwardToIngest(
  ingestUrl: string,
  message: string,
  level: LogLevelName,
  clientId: string | undefined,
  maxChars: number,
): void {
  const body: Record<string, string> = {
    message: truncate(message, maxChars),
    level,
  };
  if (clientId) body.clientId = clientId;

  void fetch(ingestUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {
    /* never break caller logging */
  });
}

/**
 * Wrap `console.log|info|warn|error|debug`: prints locally, then POSTs to Logview when enabled and
 * level meets `minLevel`. Network failures are swallowed.
 */
export function createLogviewBridge(options: LogviewBridgeOptions): LogviewBridgeHandle {
  const merged = resolveBridgeConfig({}, options);
  return installBridge(merged);
}

/**
 * Merge `loadLogviewBridgeConfigFromEnv()` with `overrides` and install the bridge.
 * Throws if no `baseUrl` after merge.
 */
export function createLogviewBridgeFromEnv(
  overrides?: Partial<LogviewBridgeOptions>,
): LogviewBridgeHandle {
  const env = loadLogviewBridgeConfigFromEnv();
  const merged = resolveBridgeConfig(env, overrides ?? {});
  return installBridge(merged);
}

type BatchEntry = { message: string; level: LogLevelName; clientId?: string; ts: string };

function flushBatch(batchUrl: string, buffer: BatchEntry[]): void {
  if (buffer.length === 0) return;
  const payload = JSON.stringify(buffer.splice(0));
  void fetch(batchUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
  }).catch(() => {/* never break caller */});
}

function installBridge(merged: ResolvedBridgeOptions): LogviewBridgeHandle {
  const ingestUrl = buildIngestUrl(merged.baseUrl, merged.ingestPath ?? "/api/ingest");
  const batchUrl = buildIngestUrl(merged.baseUrl, merged.batchPath);

  const originals = {
    log: console.log.bind(console) as (...a: unknown[]) => void,
    info: console.info.bind(console) as (...a: unknown[]) => void,
    warn: console.warn.bind(console) as (...a: unknown[]) => void,
    error: console.error.bind(console) as (...a: unknown[]) => void,
    debug:
      typeof console.debug === "function"
        ? (console.debug.bind(console) as (...a: unknown[]) => void)
        : (console.log.bind(console) as (...a: unknown[]) => void),
  };

  let disposed = false;

  // --- Batch mode ---
  const batchBuffer: BatchEntry[] = [];
  let flushTimer: ReturnType<typeof setInterval> | undefined;

  if (merged.flushInterval) {
    flushTimer = setInterval(() => {
      flushBatch(batchUrl, batchBuffer);
    }, merged.flushInterval);
    // Don't keep the process alive just for flushing
    if (flushTimer.unref) flushTimer.unref();
  }

  const enqueue = (message: string, level: LogLevelName): void => {
    const entry: BatchEntry = { message, level, ts: new Date().toISOString() };
    if (merged.clientId) entry.clientId = merged.clientId;
    batchBuffer.push(entry);
    if (batchBuffer.length >= merged.maxBatchSize) {
      flushBatch(batchUrl, batchBuffer);
    }
  };

  // --- Per-log-line send (non-batch mode) ---
  const tee =
    (level: LogLevelName, impl: (...a: unknown[]) => void) =>
    (...args: unknown[]) => {
      impl(...args);
      if (disposed || !merged.enabled) return;
      if (!shouldForwardLevel(level, merged.minLevel)) return;
      const text = formatConsoleArgs(args);
      try {
        if (merged.flushInterval) {
          enqueue(text, level);
        } else {
          forwardToIngest(ingestUrl, text, level, merged.clientId, merged.maxMessageChars);
        }
      } catch {
        /* defensive */
      }
    };

  console.log = tee("info", originals.log);
  console.info = tee("info", originals.info);
  console.warn = tee("warn", originals.warn);
  console.error = tee("error", originals.error);
  console.debug = tee("debug", originals.debug);

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (flushTimer !== undefined) {
        clearInterval(flushTimer);
        flushBatch(batchUrl, batchBuffer); // final flush
      }
      console.log = originals.log;
      console.info = originals.info;
      console.warn = originals.warn;
      console.error = originals.error;
      console.debug = originals.debug;
    },
  };
}
