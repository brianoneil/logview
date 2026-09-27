# WIP: Replay buffer + agent API + MCP

**Branch:** `feat/replay-buffer-agent-api`  
**Status:** Work in progress — builds locally; not merged to `main`.  
**Purpose:** Let humans reconnect without losing recent context, and let agents poll logs without holding SSE open forever.

---

## Problem this branch solves

Before this work:

- Logs were **fan-out only** — no retention after ingest except what the browser already had in memory.
- SSE `/api/stream` sent **live lines only** on connect (see old `requirements.md` §1).
- Agents had no supported pull API; long-lived SSE is awkward in MCP tool loops.

After this work (on this branch):

- A **bounded in-memory ring buffer** (default 500 entries) retains recent logs per process.
- **`GET /api/logs`** returns a pollable, cursor-paged snapshot (auth required).
- **SSE backlog replay** sends one `backlog` event on connect, then live `message` events.
- **`@logview/mcp`** exposes `logview_recent`, `logview_send`, and `logview_status` for AI agents.

Still **not** durable storage — process restart or eviction clears history.

---

## What is implemented

### 1. Ring buffer (`lib/log-broker.ts`)

| Piece | Behavior |
|-------|----------|
| `LOGVIEW_BUFFER_SIZE` | Max retained entries (default **500**). **`0`** disables buffer (legacy live-only behavior). |
| `append()` | Push to buffer (if enabled), then fan out to SSE subscribers. |
| `snapshot()` | Filter by `clientId`, `level`, `sinceId`, `limit` (default 200, max 500 in API). |
| `hasId()` | Whether an id is still in buffer (for `oldest` flag). |
| `subscribeWithBacklog()` | Snapshot + subscribe in one synchronous call; returns backlog array for SSE. |

Broker uses `globalThis.__logviewBroker` so Next.js dev HMR does not reset state on every reload.

### 2. `GET /api/logs` (`app/api/logs/route.ts`)

- **Auth:** Same as viewer — session cookie or `Authorization: Bearer <passphrase>`. Implemented in the route via `isAuthorizedRequest()` (not Edge middleware matcher).
- **Response:** `{ entries: LogEntry[], oldest: boolean }` — entries **oldest-first**.
- **`oldest`:** `true` when `sinceId` was omitted or points at an evicted/unknown id (caller may have missed entries).

Query params: `clientId`, `sinceId`, `level`, `limit` (1–500, default 200).

### 3. Shared auth helper (`lib/authorize-request.ts`)

Extracted from middleware so `/api/logs` and future routes can reuse the same cookie + Bearer checks on plain `Request` headers.

Middleware (`middleware.ts`) now delegates to `isAuthorizedRequest()`. Matcher unchanged: `/`, `/usage`, `/api/stream` only — **ingest stays public**.

### 4. SSE backlog replay (`app/api/stream/route.ts`)

- Uses `subscribeWithBacklog()`.
- Emits **`event: backlog`** with JSON array (oldest-first), then default **`message`** events for live lines.
- **`?backlog=0`** skips replay (pure live tail).

### 5. UI (`components/LogViewer.tsx`)

- Listens for SSE `backlog` event.
- Reverses oldest-first array before `appendEntries` (UI stores newest-first internally).

### 6. Docs / config

- **`USAGE.md`** — new section “Reading logs programmatically” (`/api/logs`, SSE backlog, MCP pointer).
- **`.env.example`** — documents `LOGVIEW_BUFFER_SIZE`.

### 7. MCP package (`packages/logview-mcp/`)

| Tool | Endpoint | Role |
|------|----------|------|
| `logview_recent` | `GET /api/logs` | Poll + page with `sinceId` → `nextSinceId` in tool output |
| `logview_send` | `POST /api/ingest` | Agent writes back (convention: `clientId: "analyst"`) |
| `logview_status` | `GET /api/logs?limit=1` | Reachability + auth probe |

**Env:** `LOGVIEW_URL` (required), `LOGVIEW_PASSPHRASE` (when auth enabled).

**Build:** `npm run build` in package (workspace member at repo root).  
**Smoke:** `npm run smoke` in package (needs running Logview + env).

**Client:** `src/client.ts` — HTTP helpers shared by MCP and smoke script (no MCP imports).

Root `package.json` workspaces includes `packages/logview-mcp`.

---

## How to run on another machine

```bash
git fetch origin
git checkout feat/replay-buffer-agent-api

npm install
npm run build                    # Next.js app
npm run build --workspace=@logview/mcp   # MCP server (or cd packages/logview-mcp && npm run build)

# .env: LOGVIEW_AUTH_* as usual; optional LOGVIEW_BUFFER_SIZE=500
npm run dev
```

**MCP (Claude Code / Cursor)** — point at built entry:

```json
{
  "mcpServers": {
    "logview": {
      "command": "node",
      "args": ["/absolute/path/to/logview/packages/logview-mcp/dist/index.js"],
      "env": {
        "LOGVIEW_URL": "http://127.0.0.1:3000",
        "LOGVIEW_PASSPHRASE": "your-passphrase"
      }
    }
  }
}
```

**Quick manual checks:**

```bash
# ingest (no auth)
curl -sS -X POST "http://127.0.0.1:3000/api/ingest" \
  -H "Content-Type: application/json" \
  -d '{"message":"wip test","clientId":"dev"}'

# read buffer (auth)
curl -sS "http://127.0.0.1:3000/api/logs?limit=10" \
  -H "Authorization: Bearer YOUR_PASSPHRASE"
```

---

## What is NOT done yet (pick up here)

### Must-do before merge

1. **Update `requirements.md`** — §1 still says “no catch-up / buffer replay on connect”; contradicts this branch. Revise vision/ephemeral wording (bounded memory retention vs disk persistence).
2. **Automated tests** — `scripts/test-harness.mjs` does not cover `/api/logs`, `sinceId`/`oldest`, or SSE `backlog`. Add harness cases or integration tests.
3. **SSE ordering review** — Stream route subscribes (live `safeSend` active) *before* enqueueing the `backlog` event. A log ingested in that window could appear **before** the backlog batch in the client. Confirm acceptable or buffer live events until backlog is sent.
4. **Middleware vs route auth** — `/api/logs` relies on route-level auth only. Fine for Bearer clients; confirm browser/session behavior matches expectations (same-origin fetches include cookies).

### Should-do

5. **Example MCP config in repo** — e.g. `.mcp.json.example` at root referencing workspace path.
6. **Update `skill-logview`** (separate repo) — `reference/api.md`, `sse-stream.md`, and skill description for `/api/logs`, backlog event, MCP tools.
7. **LogViewer UX** — Optional indicator when backlog replay loaded (count), or `?backlog=0` toggle for power users.
8. **Multi-dyno note in ops** — USAGE already warns buffer is per-process; document for Dokku/multi-container if you scale `web` > 1.

### Nice-to-have

9. Publish **`@logview/mcp`** to npm (like console-bridge).
10. **`logview_recent` filters** — substring search on `message` (would need server support or client-side filter in tool).
11. Rate limiting on `/api/logs` if agents poll aggressively.

---

## File map (this branch)

| Path | Change |
|------|--------|
| `lib/log-broker.ts` | Ring buffer, snapshot, subscribeWithBacklog |
| `lib/authorize-request.ts` | **New** — shared auth |
| `app/api/logs/route.ts` | **New** — GET recent entries |
| `app/api/stream/route.ts` | Backlog SSE event |
| `middleware.ts` | Use shared auth helper |
| `components/LogViewer.tsx` | Handle `backlog` event |
| `USAGE.md` | Programmatic read + MCP |
| `.env.example` | `LOGVIEW_BUFFER_SIZE` |
| `package.json` / `package-lock.json` | Workspace `@logview/mcp` |
| `packages/logview-mcp/*` | **New** MCP server + client + smoke |

---

## Design constraints (unchanged)

- **Ingest remains unauthenticated** — apps/scripts POST without secrets.
- **Read paths authenticated** — viewer, SSE, `/api/logs`.
- **Ephemeral** — no disk/DB; buffer size caps memory; restart clears all.
- **Per-process buffer** — not shared across horizontal replicas.

---

## Suggested merge checklist

- [ ] Requirements + README aligned with bounded replay
- [ ] Test harness or tests green for buffer + `/api/logs` + backlog
- [ ] SSE ordering verified or fixed
- [ ] MCP smoke documented in CI or README
- [ ] skill-logview updated (optional same PR, separate repo OK)
