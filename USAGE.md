# Logging to Logview

**Ingest** (`/api/ingest`) is **open**: no login or `Authorization` header required, so apps and scripts can send logs without shared secrets on the wire for ingest.

The **web UI** (live viewer, docs) and the **live stream** (`/api/stream`) require signing in with a **passphrase** (session cookie). That keeps reading logs behind login while ingest stays easy to integrate.

## Authentication (viewer & stream only)

| What | Auth |
|------|------|
| **`POST` / `GET` `/api/ingest`** | None |
| **`/`, `/usage`, SSE `/api/stream`** | Sign in in the browser (or `Authorization: Bearer <passphrase>` on `/api/stream` for non-browser clients) |

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
