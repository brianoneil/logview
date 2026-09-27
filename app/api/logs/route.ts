import { isAuthFullyConfigured } from "@/lib/auth-config";
import { isAuthorizedRequest } from "@/lib/authorize-request";
import { getLogBroker } from "@/lib/log-broker";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

function unauthorized() {
  return NextResponse.json(
    {
      error: "Unauthorized",
      hint: "Sign in in the browser or send Authorization: Bearer <passphrase>.",
    },
    { status: 401 },
  );
}

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

/**
 * GET /api/logs — read recent log entries from the in-memory ring buffer.
 * Same auth as the viewer/stream: session cookie or `Authorization: Bearer <passphrase>`.
 *
 * Query params:
 *   clientId — only entries with this clientId (default: all)
 *   sinceId  — exclusive cursor: only entries newer than this id (default: oldest retained)
 *   level    — only entries at this level (debug/info/warn/error)
 *   limit    — max entries, 1..500 (default 200)
 *
 * Response: { entries: LogEntry[], oldest: boolean }
 *   entries — oldest-first
 *   oldest  — true when the response starts at the buffer's oldest retained entry,
 *             i.e. the caller's sinceId is unknown/evicted (or was not given).
 *             Page with the id of the last entry as the next sinceId.
 */
export async function GET(request: Request) {
  if (!isAuthFullyConfigured()) {
    return NextResponse.json(
      {
        error:
          "Auth not configured. Set LOGVIEW_AUTH_SECRET (16+ chars) and LOGVIEW_AUTH_PASSPHRASES (JSON array of strings).",
      },
      { status: 503 },
    );
  }

  if (!(await isAuthorizedRequest(request.headers))) {
    return unauthorized();
  }

  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("clientId");
  const sinceId = searchParams.get("sinceId");
  const level = searchParams.get("level");
  const limit = parseLimit(searchParams.get("limit"));

  const broker = getLogBroker();
  const entries = broker.snapshot({
    clientId,
    ...(sinceId ? { sinceId } : {}),
    ...(level ? { level } : {}),
    limit,
  });
  const oldest = !sinceId || !broker.hasId(sinceId);

  return NextResponse.json({ entries, oldest });
}
