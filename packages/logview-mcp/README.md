# @logview/mcp

MCP server that exposes a [Logview](../../USAGE.md) deployment's recent logs to
AI agents over stdio. Agents pull bounded batches on demand (`logview_recent`)
instead of holding open the never-ending SSE stream, so they control how much
context they consume.

## Tools

| Tool | What it does |
|------|--------------|
| `logview_recent` | Fetch recent entries from the ring buffer (oldest-first), filter by `clientId`/`level`, page with `sinceId` → `nextSinceId` |
| `logview_send` | POST an entry to `/api/ingest` — lets an agent write findings back into the stream (convention: `clientId: "analyst"`) |
| `logview_status` | Probe reachability and authorization |

## Configure

Environment variables:

- `LOGVIEW_URL` — **required**. Base URL of the Logview deployment, e.g. `https://logview.example.com`
- `LOGVIEW_PASSPHRASE` — passphrase for `Authorization: Bearer`. Omit when the server has auth disabled (dev).

Claude Code example (`.mcp.json` in the project you want to watch from):

```json
{
  "mcpServers": {
    "logview": {
      "command": "node",
      "args": ["/path/to/logview/packages/logview-mcp/dist/index.js"],
      "env": {
        "LOGVIEW_URL": "http://127.0.0.1:3000",
        "LOGVIEW_PASSPHRASE": "alpha"
      }
    }
  }
}
```

Build first: `npm run build` in this package (or from the repo root, since it's
an npm workspace).

## Smoke test

With a Logview server running (`npm run dev` at the repo root):

```sh
npm run smoke
```

Sends an entry, reads it back, and verifies `sinceId` paging.
