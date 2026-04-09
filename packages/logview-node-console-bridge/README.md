# @logview/node-console-bridge

Forward **Node.js** `console.log` / `info` / `warn` / `error` / `debug` to a Logview **`POST /api/ingest`** endpoint while **still printing locally**. Matches the JSON ingest contract in Logview’s **`USAGE.md`** (`message`, `level`, optional `clientId`).

**Ingest is unauthenticated** in stock Logview (no `Authorization` header). The viewer and SSE stream use separate sign-in; only the ingest URL needs to be reachable from your app.

## Install

```bash
npm install @logview/node-console-bridge
```

(Until published, use `npm install file:../path/to/packages/logview-node-console-bridge` or a git/pkg URL.)

## Quick start

**Explicit options** (e.g. `instrumentation.ts` or server entry):

```ts
import { createLogviewBridge } from "@logview/node-console-bridge";

createLogviewBridge({
  baseUrl: "https://your-logview-host",
  enabled: true,
  minLevel: "info", // debug | info | warn | error
  clientId: "payments-api", // optional
});
```

**Environment-driven**:

```ts
import { createLogviewBridgeFromEnv } from "@logview/node-console-bridge";

createLogviewBridgeFromEnv();
// optional overrides (win over env):
createLogviewBridgeFromEnv({ minLevel: "warn" });
```

### Environment variables

| Variable | Meaning |
|----------|---------|
| `LOGVIEW_BASE_URL` | Origin (required for `createLogviewBridgeFromEnv` if you don’t pass `baseUrl`). |
| `LOGVIEW_BRIDGE_ENABLED` | `1` / `true` / `yes` / `on` vs `0` / `false` / … |
| `LOGVIEW_MIN_LEVEL` | `debug` · `info` · `warn` · `error` (default `info`). |
| `LOGVIEW_CLIENT_ID` | Optional `clientId` on each ingest. |
| `LOGVIEW_INGEST_PATH` | Default `/api/ingest`. |

## Turn off forwarding

- `enabled: false`, or  
- `LOGVIEW_BRIDGE_ENABLED=0`, or  
- `dispose()`:

```ts
const handle = createLogviewBridge({ baseUrl: "…", enabled: true });

// later (e.g. tests shutdown)
handle.dispose();
```

## Level mapping

| `console` | Ingest `level` |
|-----------|----------------|
| `debug` | `debug` |
| `log`, `info` | `info` |
| `warn` | `warn` |
| `error` | `error` |

Only messages at or above `minLevel` are sent (`debug` < `info` < `warn` < `error`).

## Examples

**Plain script**

```ts
import { createLogviewBridge } from "@logview/node-console-bridge";

createLogviewBridge({
  baseUrl: process.env.LOGVIEW_BASE_URL!,
  minLevel: "info",
});

console.log("still visible locally and forwarded");
```

**Express** — call `createLogviewBridge` once before `app.listen`, same process as your routes.

**Next.js** — invoke from a **server-only** module (e.g. `instrumentation.ts` with `register()`, or a small `lib/server-init.ts` imported only from Server Components / Route Handlers / `layout.tsx` server path). Do **not** import this package from client bundles (it patches `console`).

## Behavior notes

- **Fire-and-forget** `fetch`; failures do **not** throw into your code paths.
- **Large messages** are truncated (default 100,000 characters).
- **No timers** or retry loops.

## License

MIT
