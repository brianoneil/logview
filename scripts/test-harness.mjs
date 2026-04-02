#!/usr/bin/env node
/**
 * Sends sample logs to Logview for manual / local testing.
 *
 * Usage:
 *   node scripts/test-harness.mjs
 *   node scripts/test-harness.mjs --base-url=http://127.0.0.1:3000
 *   node scripts/test-harness.mjs --client-id=demo --mode=burst --count=30
 *   node scripts/test-harness.mjs --mode=steady --interval-ms=400
 *
 * Run the app first: npm run dev
 */

function parseArgs(argv) {
  const out = {
    baseUrl: "http://127.0.0.1:3000",
    clientId: "test-harness",
    mode: "steady",
    count: 25,
    intervalMs: 300,
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

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
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
  --interval-ms=N                    Steady interval between logs (default 450)

Examples:
  node scripts/test-harness.mjs --mode=burst --count=40
  node scripts/test-harness.mjs --client-id=worker-a --mode=steady
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
    `Harness → ${opts.baseUrl} (mode=${opts.mode}${opts.clientId ? `, client=${opts.clientId}` : ""})`,
  );

  if (opts.mode === "burst") {
    for (let i = 0; i < opts.count; i++) {
      const body = {
        message: `${pick(SAMPLES)}  (#${i + 1})`,
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
      const message = `${pick(SAMPLES)}  [mixed ${i + 1}]`;
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
      message: `${pick(SAMPLES)}  [steady ${i}]`,
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
