# Logging to Logview

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
