#!/usr/bin/env node
/**
 * End-to-end tests for Logview (auth, ingest, ring buffer, /api/logs, SSE backlog).
 *
 * Prerequisites:
 *   npm run dev   (or production server on --base-url)
 *
 * Usage:
 *   node scripts/test-e2e.mjs
 *   node scripts/test-e2e.mjs --base-url=http://127.0.0.1:3000
 *   node scripts/test-e2e.mjs --env-file=.env
 *
 * Loads LOGVIEW_AUTH_PASSPHRASES from --env-file (default .env in cwd) for login tests.
 * Optional: LOGVIEW_PASSPHRASE overrides the first JSON array entry (MCP-style).
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function parseArgs(argv) {
  const out = {
    baseUrl: "http://localhost:3000",
    envFile: ".env",
    help: false,
  };
  for (const raw of argv) {
    if (raw.startsWith("--base-url=")) {
      out.baseUrl = raw.slice("--base-url=".length).replace(/\/$/, "");
    } else if (raw.startsWith("--env-file=")) {
      out.envFile = raw.slice("--env-file=".length);
    } else if (raw === "--help" || raw === "-h") {
      out.help = true;
    }
  }
  return out;
}

function loadEnvFile(path) {
  const abs = resolve(path);
  if (!existsSync(abs)) return {};
  const text = readFileSync(abs, "utf8");
  const env = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

function getPassphrase(env) {
  const direct = env.LOGVIEW_PASSPHRASE?.trim();
  if (direct) return direct;
  const raw = env.LOGVIEW_AUTH_PASSPHRASES?.trim();
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && typeof arr[0] === "string" && arr[0].length > 0) {
      return arr[0];
    }
  } catch {
    /* ignore */
  }
  return null;
}

class CookieJar {
  /** @type {Map<string, string>} */
  #cookies = new Map();

  storeFrom(response, requestUrl) {
    const host = new URL(requestUrl).host;
    const list =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [];
    const fallback = response.headers.get("set-cookie");
    const parts =
      list.length > 0
        ? list.map((c) => c.split(";")[0])
        : fallback
          ? [fallback.split(";")[0]]
          : [];
    for (const p of parts) {
      const eq = p.indexOf("=");
      if (eq === -1) continue;
      this.#cookies.set(`${host}|${p.slice(0, eq).trim()}`, p.trim());
    }
  }

  headerFor(url) {
    const host = new URL(url).host;
    const pairs = [];
    for (const [key, val] of this.#cookies) {
      if (key.startsWith(`${host}|`)) pairs.push(val);
    }
    return pairs.length ? pairs.join("; ") : undefined;
  }
}

let passed = 0;
let failed = 0;

function ok(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
    return true;
  }
  failed++;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  return false;
}

async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

async function login(baseUrl, passphrase, jar) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passphrase }),
  });
  jar.storeFrom(res, baseUrl);
  return res;
}

async function fetchAuthed(baseUrl, path, jar, init = {}) {
  const url = `${baseUrl}${path}`;
  const cookie = jar.headerFor(url);
  const headers = { ...init.headers };
  if (cookie) headers.cookie = cookie;
  return fetch(url, { ...init, headers });
}

async function readSsePrefix(baseUrl, path, jar, maxBytes = 12_000, timeoutMs = 5000) {
  const url = `${baseUrl}${path}`;
  const cookie = jar.headerFor(url);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: cookie ? { cookie } : {},
      signal: ac.signal,
    });
    if (!res.ok) {
      return { ok: false, status: res.status, body: await res.text() };
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (buf.length < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
    }
    return { ok: true, status: res.status, body: buf };
  } catch (e) {
    if (e.name === "AbortError") {
      return { ok: true, status: 200, body: "", aborted: true };
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function sseEventIndex(body, eventName) {
  const needle = `event: ${eventName}`;
  return body.indexOf(needle);
}

function firstLiveDataIndex(body) {
  const backlogEnd = body.indexOf("event: backlog");
  const searchFrom = backlogEnd === -1 ? 0 : backlogEnd;
  const idx = body.indexOf("\ndata: {", searchFrom);
  if (idx === -1) return body.indexOf("data: {", searchFrom);
  return idx + 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node scripts/test-e2e.mjs [--base-url=URL] [--env-file=.env]`);
    process.exit(0);
  }

  const env = loadEnvFile(args.envFile);
  const passphrase = getPassphrase(env);
  const baseUrl = args.baseUrl;
  const altHostUrl =
    baseUrl.includes("localhost")
      ? baseUrl.replace("localhost", "127.0.0.1")
      : baseUrl.includes("127.0.0.1")
        ? baseUrl.replace("127.0.0.1", "localhost")
        : null;

  console.log(`\nLogview e2e — ${baseUrl}`);
  console.log(`env-file: ${args.envFile} (passphrase ${passphrase ? "loaded" : "MISSING"})\n`);

  const jar = new CookieJar();
  const runId = `e2e-${Date.now()}`;
  const marker = `${runId}-marker`;

  // --- Auth status (public) ---
  console.log("Auth");
  {
    const res = await fetch(`${baseUrl}/api/auth/status`);
    const data = await readJson(res);
    ok("GET /api/auth/status → 200", res.status === 200);
    ok("auth status JSON has configured", typeof data.configured === "boolean");
    if (!data.disabled && !data.configured) {
      console.error(
        "\n  Server auth is NOT configured. Set LOGVIEW_AUTH_SECRET (16+ chars) and\n" +
          "  LOGVIEW_AUTH_PASSPHRASES='[\"your-passphrase\"]' in .env, then restart dev.\n",
      );
    }
  }

  if (!passphrase && !(await fetch(`${baseUrl}/api/auth/status`).then((r) => r.json())).disabled) {
    console.error(
      "\nCannot run login tests: no passphrase in env-file.\n" +
        "Add LOGVIEW_AUTH_PASSPHRASES=[\"...\"] to .env or pass LOGVIEW_PASSPHRASE.\n",
    );
    process.exit(1);
  }

  const status = await fetch(`${baseUrl}/api/auth/status`).then((r) => r.json());
  if (!status.disabled) {
    const bad = await login(baseUrl, "__wrong-passphrase__", jar);
    ok("wrong passphrase → 401", bad.status === 401);

    const good = await login(baseUrl, passphrase, jar);
    const goodBody = await readJson(good);
    ok("login with env passphrase → 200", good.status === 200 && goodBody.ok === true);

    const sess = await fetchAuthed(baseUrl, "/api/auth/session", jar);
    const sessBody = await readJson(sess);
    ok("session with cookie → ok", sess.status === 200 && sessBody.ok === true);

    const home = await fetchAuthed(baseUrl, "/", jar, { redirect: "manual" });
    ok("GET / with session → 200 (not login redirect)", home.status === 200);

    const noAuth = await fetch(`${baseUrl}/`, { redirect: "manual" });
    ok(
      "GET / without session → redirect login",
      noAuth.status === 307 || noAuth.status === 302,
    );
  } else {
    ok("auth disabled in dev (LOGVIEW_AUTH_DISABLE)", true);
  }

  // --- Host cookie isolation (common local login bug) ---
  if (altHostUrl && !status.disabled) {
    console.log("\nHost cookie isolation");
    const altJar = new CookieJar();
    await login(baseUrl, passphrase, altJar);
    const onAlt = await fetchAuthed(altHostUrl, "/api/auth/session", altJar);
    const altBody = await readJson(onAlt);
    ok(
      "session on alternate host without re-login → not ok",
      altBody.ok !== true,
      `${new URL(baseUrl).host} cookie must not apply to ${new URL(altHostUrl).host}`,
    );
    console.log(
      `  ℹ Use one host consistently in the browser (e.g. only ${new URL(baseUrl).host}).`,
    );
  }

  // --- Ingest (public) ---
  console.log("\nIngest");
  {
    const res = await fetch(`${baseUrl}/api/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: marker,
        level: "info",
        clientId: runId,
      }),
    });
    const body = await readJson(res);
    ok("POST /api/ingest → 202", res.status === 202 && body.ok === true);
  }

  // --- /api/logs ---
  console.log("\n/api/logs");
  {
    const anon = await fetch(`${baseUrl}/api/logs?limit=5`);
    ok("GET /api/logs without auth → 401", anon.status === 401);

    const authed = status.disabled
      ? await fetch(`${baseUrl}/api/logs?clientId=${encodeURIComponent(runId)}&limit=20`)
      : await fetchAuthed(
          baseUrl,
          `/api/logs?clientId=${encodeURIComponent(runId)}&limit=20`,
          jar,
        );
    const logs = await readJson(authed);
    ok("GET /api/logs with auth → 200", authed.status === 200);
    const found = logs.entries?.some((e) => e.message === marker);
    ok("buffer contains ingested marker", found === true);
    ok("oldest flag present", typeof logs.oldest === "boolean");

    const lastId = logs.entries?.[logs.entries.length - 1]?.id;
    if (lastId) {
      const page = status.disabled
        ? await fetch(
            `${baseUrl}/api/logs?sinceId=${encodeURIComponent(lastId)}&clientId=${encodeURIComponent(runId)}`,
          )
        : await fetchAuthed(
            baseUrl,
            `/api/logs?sinceId=${encodeURIComponent(lastId)}&clientId=${encodeURIComponent(runId)}`,
            jar,
          );
      const pageBody = await readJson(page);
      ok("sinceId paging → 200", page.status === 200);
      ok(
        "sinceId after last entry → empty",
        Array.isArray(pageBody.entries) && pageBody.entries.length === 0,
      );
    }
  }

  // --- SSE backlog ---
  console.log("\nSSE /api/stream");
  {
    const bearerHeaders = status.disabled
      ? {}
      : { Authorization: `Bearer ${passphrase}` };
    const ssePath = `/api/stream?clientId=${encodeURIComponent(runId)}`;
    const url = `${baseUrl}${ssePath}`;
    const cookie = jar.headerFor(url);
    const headers = { ...bearerHeaders };
    if (cookie) headers.cookie = cookie;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 4000);
    let buf = "";
    try {
      const res = await fetch(url, { headers, signal: ac.signal });
      ok("SSE connect → 200", res.status === 200);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      while (buf.length < 16_000) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
      }
    } catch (e) {
      if (e.name !== "AbortError") throw e;
    } finally {
      clearTimeout(timer);
    }

    ok("SSE comment line present", buf.includes(": logview stream"));
    const backlogIdx = sseEventIndex(buf, "backlog");
    ok("SSE backlog event present", backlogIdx !== -1);
    ok("backlog includes marker", buf.includes(marker));

    const liveIdx = firstLiveDataIndex(buf);
    if (backlogIdx !== -1 && liveIdx !== -1 && liveIdx > backlogIdx) {
      ok("backlog appears before first live data line", true);
    } else if (backlogIdx !== -1 && !buf.slice(backlogIdx).includes("\ndata: {")) {
      ok("backlog appears before first live data line", true, "no live lines in sample");
    } else {
      ok("backlog appears before first live data line", false, "ordering check");
    }
  }

  // --- MCP HTTP client (same as packages/logview-mcp smoke) ---
  console.log("\nMCP HTTP client");
  try {
    const { fetchLogs, probeServer, sendLog } = await import(
      "../packages/logview-mcp/dist/client.js"
    );
    const mcpConfig = {
      baseUrl,
      ...(passphrase ? { passphrase } : {}),
    };
    const probe = await probeServer(mcpConfig);
    ok("MCP probeServer ok", probe.ok === true, probe.detail);
    await sendLog(mcpConfig, {
      message: `${marker}-mcp`,
      clientId: runId,
      level: "info",
    });
    const { entries } = await fetchLogs(mcpConfig, { clientId: runId, limit: 10 });
    ok(
      "MCP fetchLogs finds mcp line",
      entries.some((e) => e.message === `${marker}-mcp`),
    );
  } catch (e) {
    ok(
      "MCP client (build packages/logview-mcp first)",
      false,
      e instanceof Error ? e.message : String(e),
    );
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
  console.log("All e2e checks passed. Safe for local use on this branch.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
