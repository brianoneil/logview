# Logging to Logview

**Ingest** (`/api/ingest`) is **open**: no login or `Authorization` header required, so apps and scripts can send logs without shared secrets on the wire for ingest.

The **web UI** (live viewer, docs) and the **live stream** (`/api/stream`) require signing in with a **passphrase** (session cookie). That keeps reading logs behind login while ingest stays easy to integrate.

## Authentication (viewer & stream only)

| What | Auth |
|------|------|
| **`POST` / `GET` `/api/ingest`** | None |
| **`/`, `/usage`, SSE `/api/stream`, `GET /api/logs`** | Sign in in the browser (or `Authorization: Bearer <passphrase>` on `/api/stream` and `/api/logs` for non-browser clients) |

Configure on the server:

- `LOGVIEW_AUTH_SECRET` — at least **16 characters**; used to sign session JWTs. Keep secret.
- `LOGVIEW_AUTH_PASSPHRASES` — JSON array of strings, e.g. `["alpha","beta"]`. **Multiple** passphrases are supported.

See `.env.example` in the repo.

**HTTPS** is strongly recommended in production.

---

Ingest URL (this deployment):

**`https://logview.lotsgoingon.com/api/ingest`**

Use **`POST`** or **`GET`**. A successful write returns **`202`** with `{"ok":true,"id":"…"}`.

---

## POST — JSON

`Content-Type: application/json`

| Field | Required | Description |
|-------|----------|-------------|
| `message` or `msg` | Yes | Log line text |
| `level` | No | e.g. `debug`, `info`, `warn`, `error` (default `info`) |
| `clientId` | No | Optional tag for this log source |
| `ts` | No | ISO timestamp; server sets one if omitted |

```bash
curl -sS -X POST "https://logview.lotsgoingon.com/api/ingest" \
  -H "Content-Type: application/json" \
  -d '{"message":"Server started","level":"info","clientId":"my-service"}'
```

```javascript
await fetch("https://logview.lotsgoingon.com/api/ingest", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    message: "Something happened",
    level: "warn",
    clientId: "worker-1",
  }),
});
```

---

## POST — plain text

`Content-Type: text/plain` — body is the whole message (no `level` / `clientId`).

```bash
curl -sS -X POST "https://logview.lotsgoingon.com/api/ingest" \
  -H "Content-Type: text/plain" \
  --data-binary "one line of text"
```

---

## GET — query string

| Parameter | Required | Description |
|-----------|----------|-------------|
| `message` or `m` | Yes | Log text (URL-encoded) |
| `level` | No | Same as JSON |
| `clientId` | No | Same as JSON |
| `ts` | No | Same as JSON |

```bash
curl -sS "https://logview.lotsgoingon.com/api/ingest?message=hello&level=info&clientId=batch-job"
```

For long messages, use **POST JSON** instead of GET (URL length limits).

---

## POST — batch (multiple entries)

**`POST /api/ingest/batch`** — send an array of log entries in one request. Useful for clients that buffer locally and flush on an interval rather than posting every line individually. Each entry follows the same shape as the single JSON ingest.

`Content-Type: application/json` — body is a JSON **array**.

| Field | Required | Description |
|-------|----------|-------------|
| `message` or `msg` | Yes | Log line text |
| `level` | No | `debug`, `info`, `warn`, `error` (default `info`) |
| `clientId` | No | Optional tag for this log source |
| `ts` | No | ISO timestamp; server sets one if omitted |

Max batch size: **500 entries** per request.

Returns **`202`** with `{"ok":true,"count":N,"ids":["…","…"]}`.

```bash
curl -sS -X POST "https://logview.lotsgoingon.com/api/ingest/batch" \
  -H "Content-Type: application/json" \
  -d '[
    {"message":"Worker started","level":"info","clientId":"worker-1"},
    {"message":"Processing item 42","level":"debug","clientId":"worker-1"},
    {"message":"Item 42 done","level":"info","clientId":"worker-1"}
  ]'
```

```javascript
// Buffer logs locally, flush every 5 seconds
const buffer = [];

function log(message, level = "info", clientId) {
  buffer.push({ message, level, clientId, ts: new Date().toISOString() });
}

async function flush() {
  if (buffer.length === 0) return;
  const batch = buffer.splice(0);
  await fetch("https://logview.lotsgoingon.com/api/ingest/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(batch),
  });
}

setInterval(flush, 5_000);
```

---

## Reading logs programmatically

Logview keeps the most recent entries in a small **in-memory ring buffer** (default
**500**, configurable with `LOGVIEW_BUFFER_SIZE`; `0` disables retention). Nothing is
written to disk — the buffer dies with the process. Two ways to read it:

### `GET /api/logs` — pull recent entries

Same auth as the viewer (`Authorization: Bearer <passphrase>` or a browser session).

| Parameter | Required | Description |
|-----------|----------|-------------|
| `clientId` | No | Only entries with this clientId (default: all) |
| `sinceId` | No | Exclusive cursor: only entries newer than this id |
| `level` | No | Only entries at this level (`debug`, `info`, `warn`, `error`) |
| `limit` | No | Max entries, 1–500 (default 200) |

Returns **`200`** with `{"entries":[…],"oldest":true}` — entries are
**oldest-first**, each shaped like an ingest entry (`id`, `ts`, `level`,
`message`, optional `clientId`). `oldest` is `true` when the response starts at
the buffer's oldest retained entry (i.e. entries before it may have been
evicted, or no `sinceId` was given). **Page** by passing the last entry's `id`
as `sinceId` on the next request.

```bash
curl -sS "https://logview.lotsgoingon.com/api/logs?limit=50" \
  -H "Authorization: Bearer alpha"
```

This is the endpoint agents and scripts should poll — unlike the SSE stream, you
control exactly how much you read per call.

### SSE `/api/stream` — backlog replay on connect

On connect the stream now sends **one `backlog` event first** (a JSON array of
recent entries, oldest-first), then live entries as default `message` events.
Reconnects therefore recover the recent past. Pass **`?backlog=0`** to skip the
replay and get a pure live tail.

### MCP server for AI agents

**`packages/logview-mcp`** (npm workspace `@logview/mcp`) is an MCP server that
exposes the tools above to agents: `logview_recent` (fetch + `sinceId` paging),
`logview_send` (write annotations back into the stream — convention:
`clientId: "analyst"`), and `logview_status`. Configure with `LOGVIEW_URL` and
`LOGVIEW_PASSPHRASE`; see `packages/logview-mcp/README.md`.

> Note: the buffer (like the SSE fan-out) is per-process. Scale `web` beyond one
> container and each instance only knows about the logs it ingested.
