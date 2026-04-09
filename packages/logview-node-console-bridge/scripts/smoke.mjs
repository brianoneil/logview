#!/usr/bin/env node
/**
 * Run Logview (`npm run dev` at repo root) or set LOGVIEW_BASE_URL, then:
 *   npm run build && npm run smoke
 */
import { createLogviewBridge } from "../dist/index.js";

const baseUrl = process.env.LOGVIEW_BASE_URL?.trim() || "http://127.0.0.1:3000";

const handle = createLogviewBridge({
  baseUrl,
  enabled: true,
  minLevel: "debug",
  clientId: "node-console-bridge-smoke",
});

console.log("smoke: console.log");
console.info("smoke: console.info");
console.warn("smoke: console.warn");
console.debug?.("smoke: console.debug");

handle.dispose();
console.log("smoke: after dispose (local only)");
