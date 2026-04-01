# Logview — Remote, real-time log viewer

## Vision

Logview is a **remote logging sink** for other applications. Any app (CLI, service, browser extension, script) can send log lines to Logview over HTTP; operators open a single web page and **watch logs stream in live**, with readable formatting and quick filtering—**without persisting logs** to disk or a database. When nobody is connected or after a session ends, log data simply disappears from memory.

---

## User story

As an engineer running or debugging an app, I want to **point my process at a Logview URL** (POST body or GET query string) so that **every log line appears instantly** in a browser tab, with timestamps, levels, and ANSI styling preserved. I want to **narrow what I see by typing a filter** (substring or simple pattern) so I can focus on errors or a subsystem, **without** managing log files or a log aggregation product.

---

## Core behaviors

### 1. Ephemeral logs

- Logs exist **only in server memory** for the duration of live delivery.
- **No persistence**: no files, no DB, no replay after refresh (unless we explicitly add that later).
- Acceptable tradeoff: restart or crash clears buffered log state; the product is for **live tailing**, not audit trails.

### 2. Real-time delivery (SSE)

- Transport is **Server-Sent Events (SSE)**: **one-way** stream from server to browser, which matches Logview (clients only need to **receive** new log lines; ingest stays on separate HTTP **POST/GET** routes).
- The UI opens a long-lived **GET** endpoint (e.g. `EventSource` in the browser) that emits events as log lines arrive; no WebSockets required for v1.
- Backend accepts ingest over HTTP; it **fans out** each accepted line to all connected SSE clients (optionally scoped—see client identifier below).

### 3. Ingest API (easy integration)

- **POST** route: log payload in **request body** (JSON or plain text—exact shape TBD during implementation).
- **GET** route: same information expressible as **query parameters** so scripts and tools can `curl` or open a URL without a JSON client.
- Both routes should map to the same internal “append log event” pipeline.

### 4. Optional client / stream identifier

- Ingest may include an **optional client identifier** (e.g. `clientId`, `session`, or `stream`).
- The viewer may **subscribe to one client**, **all clients**, or switch streams—so multiple apps can share one Logview instance without interleaving noise (exact UX TBD).

### 5. Console encoding → HTML

- Support **standard ANSI / console escape sequences** (colors, bold, etc.) and render them as **HTML** in the UI.
- Prefer a **maintained library** for ANSI-to-HTML conversion rather than hand-rolling parsers.

### 6. Table-oriented UI

- **Web page** presenting logs in a **table** (or table-like list) with columns such as:
  - Timestamp  
  - Log level (e.g. error, warn, info, debug)  
  - Message (with ANSI rendered as styled HTML)  
  - Optional: client id, source, or other standard fields we agree on during implementation  
- Layout stays **readable and scannable** for engineering use (dense but not cluttered).

### 7. Filter as you type (client-side)

- A **filter control** on the page; as the user types, the visible rows **update immediately** to match.
- Filtering is **purely in the browser** over the rows already received in the session (substring match is sufficient for v1; regex optional later).
- Filtering does **not** change what the server holds; it only changes **visibility** of buffered-in-memory lines in the UI.

---

## Technical direction (non-binding)

- **Framework**: **[Next.js](https://nextjs.org/)** (App Router, TypeScript) on a single Node server for Dokku. UI lives in React; **Route Handlers** (`app/api/.../route.ts`) handle HTTP ingest and the **SSE** stream (ReadableStream / `text/event-stream` response).
- **Rendering**: Default **Server Components** where appropriate; **client components** for the live log table, filter input, and `EventSource` subscription to the SSE endpoint.

---

## Deployment — Dokku (Node app)

Logview is intended to run as a **Node.js web process** on **[Dokku](https://dokku.com/)** (Docker-backed, Heroku-style deploys). Repo layout follows the **Heroku Node buildpack** convention unless you intentionally switch builders.

### Default: buildpack deploy (this repo)

- **`package.json`**: **`engines.node`** is `>=20`. **`typescript`** and **`@types/*`** live in **`dependencies`** so `next build` succeeds when Dokku (or any host) runs **`npm install` / `npm ci` without devDependencies**. **`npm run build`** runs `next build`; **`npm start`** runs `next start` after install.
- **`next.config.mjs`**: JavaScript config (avoids loading **`next.config.ts`** without TypeScript on lean production installs). **`eslint.ignoreDuringBuilds`** skips ESLint during deploy builds; run **`npm run lint`** locally or in CI.
- **`Procfile`**: defines the `web` process (`web: npm start`). Dokku uses process types from the Procfile; the **`web`** process receives HTTP traffic from the proxy.
- **`app.json`**: optional `formation` to pin **one** `web` dyno/container (Dokku honors this for scaling defaults).
- **`.nvmrc`**: hints local and CI Node version (20); aligns with the Node buildpack.
- **`package-lock.json`**: commit this file so install versions are reproducible on the server.

The server **must listen on `process.env.PORT`**. **`next start`** reads **`PORT`** from the environment (Dokku sets it). **`next start`** defaults to hostname **`0.0.0.0`**, so the app accepts traffic inside the container without extra flags.

**SSE / reverse proxy:** `/api/stream` sets **`X-Accel-Buffering: no`** so nginx-style proxies (including Dokku’s default) should not buffer the event stream. If the UI still never leaves “Connecting…” behind your proxy, confirm nginx honors that header or disable buffering for that `location`.

### Dokku operator checklist

1. On your machine: run **`npm run build`** once so the app compiles cleanly before the first push.
2. Ensure **`package-lock.json`** is committed.
3. Create the app: `dokku apps:create logview` (name as you prefer).
4. Deploy: `git remote add dokku dokku@<host>:logview` then `git push dokku main` (or your default branch).
5. Set domain / SSL as you normally do on Dokku (`domains`, Let’s Encrypt plugin, etc.).
6. If detection picks the wrong buildpack: `dokku buildpacks:set logview https://github.com/heroku/heroku-buildpack-nodejs`.
7. Scale: `dokku ps:scale logview web=1` — or rely on `app.json` `formation` (presence of `formation` overrides exclusive use of `ps:scale` for those keys).
8. If **`next build` exits with heap / OOM** on a small VPS, raise Node’s limit for the build, e.g. `dokku config:set logview NODE_OPTIONS=--max-old-space-size=4096`, redeploy, then remove or lower if you like after a successful build.

### Dockerfile deploy (alternative, not in repo root today)

If a **`Dockerfile` exists at the repository root**, Dokku’s default behavior is to use the **Dockerfile builder** instead of buildpacks. That path is valid for Logview, but then you maintain the image yourself (base Node image, `CMD`, dependencies). If you use a Dockerfile:

- Listen on **`process.env.PORT`** inside the container.
- Be careful with **`EXPOSE`**: mismatches between exposed ports and what the app listens on can confuse the default nginx proxy; you may need `dokku proxy:ports-set <app> http:80:<container-port>` or clear/adjust mappings per [Dokku port / troubleshooting docs](https://dokku.com/docs/getting-started/troubleshooting/).

**This project currently has no root `Dockerfile`** so pushes use the Node buildpack + `Procfile` flow.

### Runtime dependencies

Production npm dependencies (**Next.js**, **React**, plus libraries for ANSI→HTML, streaming transport, etc.) live under `dependencies` in `package.json` and grow as ingest and realtime features are implemented.

---

## Out of scope (for initial version)

- Long-term storage, search across historical runs, or multi-day retention.
- Authentication / multi-tenancy (unless added explicitly later).
- Log rotation, archiving, or export (could be a follow-up).

---

## Success criteria

- Another app can send logs via **POST or GET** and see them **instantly** on the page.
- ANSI styling appears **correctly** in the message column.
- The page supports **live filtering as you type** without extra round-trips.
- **No persistence** of log lines beyond in-memory live viewing.
