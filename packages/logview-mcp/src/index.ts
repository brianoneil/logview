#!/usr/bin/env node
/**
 * @logview/mcp — MCP server exposing Logview recent-log tools over stdio.
 *
 * Configure via environment:
 *   LOGVIEW_URL        Base URL of the Logview deployment (required)
 *   LOGVIEW_PASSPHRASE Passphrase for Authorization: Bearer (omit if auth is disabled)
 */
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import {
  fetchLogs,
  formatEntry,
  loadConfigFromEnv,
  LogviewConfigError,
  probeServer,
  sendLog,
  type LogEntry,
  type LogviewConfig,
} from "./client.js";

serveStdio(() => {
  let config: LogviewConfig | null;
  try {
    config = loadConfigFromEnv();
  } catch (e) {
    if (e instanceof LogviewConfigError) {
      // Tools still register; each call reports the configuration problem so the
      // agent can surface it instead of the server dying silently at startup.
      config = null;
    } else {
      throw e;
    }
  }

  const server = new McpServer({ name: "logview", version: "0.1.0" });

  server.registerTool(
    "logview_recent",
    {
      description:
        "Fetch recent log entries from the Logview ring buffer (oldest-first, bounded — the server only retains the last few hundred entries; there is no long-term history). " +
        "Poll this tool to tail a stream instead of opening a never-ending SSE connection. " +
        "Page by passing the returned nextSinceId as sinceId on the next call. " +
        "If oldest=true, entries older than the response may have been evicted from the buffer.",
      inputSchema: z.object({
        clientId: z
          .string()
          .optional()
          .describe("Only entries from this log source (omit for all sources)"),
        sinceId: z
          .string()
          .optional()
          .describe("Exclusive cursor: only entries newer than this id (from a previous call's nextSinceId)"),
        level: z
          .string()
          .optional()
          .describe("Only entries at this level: debug, info, warn, or error"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Max entries to return (default 200)"),
      }),
    },
    async ({ clientId, sinceId, level, limit }) => {
      if (!config) {
        return missingConfigResult();
      }
      const { entries, oldest } = await fetchLogs(config, {
        ...(clientId ? { clientId } : {}),
        ...(sinceId ? { sinceId } : {}),
        ...(level ? { level } : {}),
        ...(limit !== undefined ? { limit } : {}),
      });
      return formatRecentResult(entries, oldest);
    },
  );

  server.registerTool(
    "logview_send",
    {
      description:
        "Send a log entry to the Logview stream (POST /api/ingest). " +
        "Useful for closing the loop: an agent analyzing a stream can write its findings back so they appear " +
        "in the same live viewer a human is watching. By convention, annotate with clientId 'analyst' so " +
        "analysis rows are visually distinguishable from application logs.",
      inputSchema: z.object({
        message: z.string().describe("Log line text"),
        level: z
          .string()
          .optional()
          .describe("debug, info, warn, or error (default info)"),
        clientId: z
          .string()
          .optional()
          .describe("Tag for this log source (convention: 'analyst' for agent annotations)"),
      }),
    },
    async ({ message, level, clientId }) => {
      if (!config) {
        return missingConfigResult();
      }
      const { id } = await sendLog(config, {
        message,
        ...(level ? { level } : {}),
        ...(clientId ? { clientId } : {}),
      });
      return textResult(`Sent as entry ${id}.`);
    },
  );

  server.registerTool(
    "logview_status",
    {
      description:
        "Check that the Logview server is reachable and this MCP server is authorized to read logs. " +
        "Run this first when logview_recent returns unexpected errors.",
      inputSchema: z.object({}),
    },
    async () => {
      if (!config) {
        return missingConfigResult();
      }
      const probe = await probeServer(config);
      const text = probe.ok
        ? `Reachable and authorized at ${config.baseUrl}${
            config.passphrase ? " (Bearer)" : " (no auth required)"
          }.`
        : `Problem at ${config.baseUrl}: ${probe.detail} — check LOGVIEW_URL / LOGVIEW_PASSPHRASE and whether the server has auth enabled.`;
      return { content: [{ type: "text", text }] };
    },
  );

  return server;
});

type TextContent = { type: "text"; text: string };
type ToolResult = { content: TextContent[]; isError?: boolean };

function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function missingConfigResult(): ToolResult {
  return {
    content: [
      {
        type: "text",
        text:
          "Logview MCP server is not configured: LOGVIEW_URL is not set. " +
          "Set LOGVIEW_URL (and LOGVIEW_PASSPHRASE if the server requires auth) in the MCP server config and reconnect.",
      },
    ],
    isError: true,
  };
}

function formatRecentResult(entries: LogEntry[], oldest: boolean): ToolResult {
  if (entries.length === 0) {
    return textResult(
      "No matching entries in the buffer. Entries are ephemeral — if nothing has been ingested recently, there is nothing to read.",
    );
  }
  const lines = entries.map(formatEntry);
  const nextSinceId = entries[entries.length - 1].id;
  const header = oldest
    ? `${entries.length} entries (oldest retained; older entries may have been evicted)`
    : `${entries.length} entries`;
  return {
    content: [
      { type: "text", text: `${header}\n${lines.join("\n")}` },
      { type: "text", text: `nextSinceId: ${nextSinceId}` },
    ],
  };
}
