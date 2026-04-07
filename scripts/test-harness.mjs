#!/usr/bin/env node
/**
 * Sends sample logs to Logview for manual / local testing.
 *
 * Usage:
 *   node scripts/test-harness.mjs
 *   node scripts/test-harness.mjs --base-url=http://127.0.0.1:3000
 *   node scripts/test-harness.mjs --client-id=demo --mode=burst --count=30
 *   node scripts/test-harness.mjs --mode=steady --interval-ms=400
 *   node scripts/test-harness.mjs --no-structured-json   # plain + ANSI lines only
 *   node scripts/test-harness.mjs --no-markdown-samples
 *
 * Run the app first: npm run dev
 */

function parseArgs(argv) {
  const out = {
    baseUrl: "http://127.0.0.1:3000",
    clientId: "test",
    mode: "steady",
    count: 25,
    intervalMs: 300,
    structuredJson: true,
    markdownSamples: true,
    help: false,
  };
  for (const raw of argv) {
    if (raw.startsWith("--base-url=")) {
      out.baseUrl = raw.slice("--base-url=".length).replace(/\/$/, "");
    } else if (raw.startsWith("--client-id=")) {
      out.clientId = raw.slice("--client-id=".length);
    } else if (raw.startsWith("--mode=")) {
      out.mode = raw.slice("--mode=".length);
    } else if (raw.startsWith("--count=")) {
      out.count = Number(raw.slice("--count=".length));
    } else if (raw.startsWith("--interval-ms=")) {
      out.intervalMs = Number(raw.slice("--interval-ms=".length));
    } else if (raw === "--no-structured-json") {
      out.structuredJson = false;
    } else if (raw === "--no-markdown-samples") {
      out.markdownSamples = false;
    } else if (raw === "--help" || raw === "-h") {
      out.help = true;
    }
  }
  return out;
}

const LEVELS = ["debug", "info", "warn", "error"];

const SAMPLES = [
  "booting worker…",
  "connected to database",
  "cache miss for key user:42",
  "request completed in 12ms",
  "\x1b[31mhandled rejection:\x1b[0m timeout",
  "\x1b[1m\x1b[32mOK\x1b[0m deploy finished",
  "\x1b[90mdim trace\x1b[0m optional details here",
];

/**
 * Log `message` strings that are JSON objects/arrays (and one ANSI-wrapped object) so
 * Logview’s structured JSON row UI can be tested alongside plain/ANSI lines.
 */
const STRUCTURED_JSON_MESSAGES = [
  JSON.stringify({
    event: "http_request",
    method: "POST",
    path: "/api/ingest",
    status: 204,
    ms: 4.2,
  }),
  JSON.stringify({
    error: true,
    code: "E_DB_TIMEOUT",
    retryable: true,
    context: { host: "db.internal", port: 5432 },
  }),
  JSON.stringify([
    { id: "job-1", state: "running" },
    { id: "job-2", state: "done", durationMs: 120 },
  ]),
  `\x1b[36m${JSON.stringify({
    ansiWrapped: true,
    note: "JSON with ANSI wrapper (strip + parse)",
  })}\x1b[0m`,
];

/** Multiline Markdown bodies for the MD visualizer (every 6th line when not JSON). */
const MARKDOWN_SAMPLES = [
  "## Harness\n\n- **build**: ok\n- tail [USAGE](/usage)",
  "> quote\n\nInline `code` and **bold** in one line.",
  "**Checklist**\n\n1. open Logview\n2. run harness\n3. expand **MD** rows",
  "### Trace\n\n- latency `12ms`\n- path `/api/ingest`",
  [
    "## Deploy report\n\n",
    "| Stage | Status | Detail |\n",
    "| ----- | ------ | ------ |\n",
    "| build | **ok** | `npm run build` |\n",
    "| test | _skipped_ | manual only |\n",
    "| ingest | `POST` | `/api/ingest` |\n\n",
    "```http\nPOST /api/ingest HTTP/1.1\nContent-Type: application/json\n\n",
    '{ "message": "circuit breaker open", "level": "warn" }\n',
    "```\n\n",
    "1. **Traffic split**\n",
    "   - edge: **99%**\n",
    "   - canary: `1%`\n",
    "2. **Follow-ups**\n",
    "   - [ ] expand row\n",
    "   - [x] verify **MD** badge\n\n",
    "---\n\n",
    "> _Stress sample_: GFM **table**, fenced block, numbered + nested bullets, task ticks, HR.\n",
  ].join(""),
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Every 4th line is structured JSON (when enabled). Every 6th line (and not 4th) is Markdown.
 * Special lines are unprefixed so client detectors see valid JSON / markdown.
 */
function harnessMessage(seq, label, structuredJson, markdownSamples) {
  if (structuredJson && seq > 0 && seq % 4 === 0) {
    return pick(STRUCTURED_JSON_MESSAGES);
  }
  if (markdownSamples && seq > 0 && seq % 6 === 0) {
    return pick(MARKDOWN_SAMPLES);
  }
  return `${pick(SAMPLES)}  (${label} ${seq})`;
}

async function postIngest(baseUrl, body) {
  const url = `${baseUrl}/api/ingest`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${url} -> ${res.status} ${text}`);
  }
}

async function getIngest(baseUrl, params) {
  const u = new URL(`${baseUrl}/api/ingest`);
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, v);
  }
  const res = await fetch(u);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${u} -> ${res.status} ${text}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(`
Logview test harness

Options:
  --base-url=http://127.0.0.1:3000   Target Logview origin
  --client-id=NAME                   Optional clientId on each log
  --mode=steady|burst|mixed          steady: periodic JSON POST; burst: fast POST; mixed: POST + GET
  --count=N                          Burst / mixed total sends (default 25)
  --interval-ms=N                    Steady interval between logs (default 300)
  --no-structured-json               Skip JSON object/array log lines (plain + ANSI only)
  --no-markdown-samples             Skip periodic Markdown log bodies (MD visualizer)

By default, every 4th line is JSON, every 6th (non-JSON) line is Markdown, for visualizer QA.

Examples:
  node scripts/test-harness.mjs --mode=burst --count=40
  node scripts/test-harness.mjs --client-id=worker-a --mode=steady
  node scripts/test-harness.mjs --no-structured-json
  node scripts/test-harness.mjs --no-markdown-samples
`);
    process.exit(0);
  }

  if (!Number.isFinite(opts.count) || opts.count < 1) {
    console.error("Invalid --count");
    process.exit(1);
  }
  if (!Number.isFinite(opts.intervalMs) || opts.intervalMs < 1) {
    console.error("Invalid --interval-ms");
    process.exit(1);
  }

  const common = {};
  if (opts.clientId) common.clientId = opts.clientId;

  console.error(
    `Harness → ${opts.baseUrl} (mode=${opts.mode}${opts.clientId ? `, client=${opts.clientId}` : ""}${opts.structuredJson ? ", json" : ""}${opts.markdownSamples ? ", md" : ""})`,
  );

  if (opts.mode === "burst") {
    for (let i = 0; i < opts.count; i++) {
      const body = {
        message: harnessMessage(
          i + 1,
          "burst",
          opts.structuredJson,
          opts.markdownSamples,
        ),
        level: pick(LEVELS),
        ...common,
      };
      await postIngest(opts.baseUrl, body);
    }
    console.error("Burst complete.");
    return;
  }

  if (opts.mode === "mixed") {
    for (let i = 0; i < opts.count; i++) {
      const message = harnessMessage(
        i + 1,
        "mixed",
        opts.structuredJson,
        opts.markdownSamples,
      );
      const level = pick(LEVELS);
      if (i % 2 === 0) {
        await postIngest(opts.baseUrl, { message, level, ...common });
      } else {
        await getIngest(opts.baseUrl, {
          message,
          level,
          ...(opts.clientId ? { clientId: opts.clientId } : {}),
        });
      }
    }
    console.error("Mixed run complete.");
    return;
  }

  if (opts.mode !== "steady") {
    console.error(`Unknown mode: ${opts.mode}`);
    process.exit(1);
  }

  let i = 0;
  const tick = async () => {
    i += 1;
    const body = {
      message: harnessMessage(
        i,
        "steady",
        opts.structuredJson,
        opts.markdownSamples,
      ),
      level: pick(LEVELS),
      ...common,
    };
    try {
      await postIngest(opts.baseUrl, body);
    } catch (e) {
      console.error("Ingest failed:", e);
    }
  };

  await tick();
  const handle = setInterval(tick, opts.intervalMs);

  const shutdown = () => {
    clearInterval(handle);
    console.error("Harness stopped.");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
