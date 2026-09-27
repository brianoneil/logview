#!/usr/bin/env node
/**
 * Run Logview (`npm run dev` at repo root) or set LOGVIEW_URL, then:
 *   npm run build && npm run smoke
 * Requires the server's auth to be disabled (dev) or LOGVIEW_PASSPHRASE to be set.
 */
import {
  fetchLogs,
  formatEntry,
  loadConfigFromEnv,
  probeServer,
  sendLog,
} from "../dist/client.js";

const config = loadConfigFromEnv();

console.log(`smoke: probing ${config.baseUrl}`);
const probe = await probeServer(config);
console.log(`smoke: probe ${probe.ok ? "ok" : "FAILED"} — ${probe.detail}`);
if (!probe.ok) process.exit(1);

await sendLog(config, {
  message: "smoke: sent from @logview/mcp",
  level: "info",
  clientId: "logview-mcp-smoke",
});

const { entries, oldest } = await fetchLogs(config, { limit: 5 });
console.log(`smoke: fetched ${entries.length} entries (oldest=${oldest})`);
for (const entry of entries) {
  console.log(`  ${formatEntry(entry)}`);
}

const lastId = entries[entries.length - 1]?.id;
if (lastId) {
  const next = await fetchLogs(config, { sinceId: lastId, limit: 5 });
  console.log(
    `smoke: sinceId paging — ${next.entries.length} entries after ${lastId}`,
  );
}
