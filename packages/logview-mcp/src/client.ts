/**
 * Thin HTTP client for a Logview server's /api/logs (read) and /api/ingest (write)
 * endpoints. Kept free of MCP dependencies so the smoke script (and other tooling)
 * can use it directly.
 */

export interface LogEntry {
  id: string;
  ts: string;
  level: string;
  message: string;
  clientId?: string;
}

export interface LogviewConfig {
  /** Base URL of the Logview deployment, e.g. https://logview.example.com */
  baseUrl: string;
  /** Passphrase for Authorization: Bearer. Omit when the server has auth disabled (dev). */
  passphrase?: string;
}

export class LogviewConfigError extends Error {}

export function loadConfigFromEnv(): LogviewConfig {
  const baseUrl = process.env.LOGVIEW_URL?.trim();
  if (!baseUrl) {
    throw new LogviewConfigError(
      "LOGVIEW_URL is not set. Point it at your Logview deployment, e.g. LOGVIEW_URL=http://127.0.0.1:3000",
    );
  }
  const passphrase = process.env.LOGVIEW_PASSPHRASE?.trim();
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    ...(passphrase ? { passphrase } : {}),
  };
}

function authHeaders(config: LogviewConfig): Record<string, string> {
  return config.passphrase
    ? { Authorization: `Bearer ${config.passphrase}` }
    : {};
}

export interface FetchLogsParams {
  clientId?: string;
  sinceId?: string;
  level?: string;
  limit?: number;
}

export interface FetchLogsResult {
  /** Oldest-first. */
  entries: LogEntry[];
  /** true when the response starts at the buffer's oldest retained entry (sinceId unknown/evicted or absent). */
  oldest: boolean;
}

export async function fetchLogs(
  config: LogviewConfig,
  params: FetchLogsParams = {},
): Promise<FetchLogsResult> {
  const url = new URL("/api/logs", config.baseUrl);
  if (params.clientId) url.searchParams.set("clientId", params.clientId);
  if (params.sinceId) url.searchParams.set("sinceId", params.sinceId);
  if (params.level) url.searchParams.set("level", params.level);
  if (params.limit !== undefined) {
    url.searchParams.set("limit", String(params.limit));
  }

  const res = await fetch(url, { headers: authHeaders(config) });
  if (!res.ok) {
    throw new Error(
      `GET /api/logs failed: ${res.status} ${res.statusText} — ${await res.text()}`,
    );
  }
  const body = (await res.json()) as FetchLogsResult;
  return body;
}

export interface SendLogParams {
  message: string;
  level?: string;
  clientId?: string;
}

export async function sendLog(
  config: LogviewConfig,
  params: SendLogParams,
): Promise<{ ok: boolean; id: string }> {
  const res = await fetch(new URL("/api/ingest", config.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(config),
    },
    body: JSON.stringify({
      message: params.message,
      ...(params.level ? { level: params.level } : {}),
      ...(params.clientId ? { clientId: params.clientId } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(
      `POST /api/ingest failed: ${res.status} ${res.statusText} — ${await res.text()}`,
    );
  }
  return (await res.json()) as { ok: boolean; id: string };
}

/** Probe the server with a minimal /api/logs request; never throws. */
export async function probeServer(
  config: LogviewConfig,
): Promise<{ ok: boolean; status: number; detail: string }> {
  try {
    const res = await fetch(new URL("/api/logs?limit=1", config.baseUrl), {
      headers: authHeaders(config),
    });
    const detail = res.ok
      ? "reachable, authorized"
      : `${res.status} ${res.statusText}: ${await res.text()}`;
    return { ok: res.ok, status: res.status, detail };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

export function formatEntry(entry: LogEntry): string {
  const client = entry.clientId ? ` [${entry.clientId}]` : "";
  return `${entry.ts} ${entry.level.toUpperCase().padEnd(5)}${client} ${entry.message}`;
}
