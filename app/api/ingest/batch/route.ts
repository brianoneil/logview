import { getLogBroker, normalizeLevel } from "@/lib/log-broker";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BATCH = 500;

/**
 * POST /api/ingest/batch
 * Body: application/json — array of log entries, each with the same shape as /api/ingest.
 * [{ message, level?, clientId?, ts? }, ...]
 *
 * Returns: { ok: true, count: N, ids: [...] }
 *
 * Entries are fanned out to live SSE subscribers in order. No auth required (same as /api/ingest).
 */
export async function POST(request: Request) {
  try {
    const ct = request.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) {
      return NextResponse.json(
        { error: "Content-Type must be application/json" },
        { status: 415 },
      );
    }

    const body = await request.json();

    if (!Array.isArray(body)) {
      return NextResponse.json(
        { error: "Body must be a JSON array of log entries" },
        { status: 400 },
      );
    }

    if (body.length === 0) {
      return NextResponse.json({ ok: true, count: 0, ids: [] }, { status: 202 });
    }

    if (body.length > MAX_BATCH) {
      return NextResponse.json(
        { error: `Batch size exceeds maximum of ${MAX_BATCH}` },
        { status: 400 },
      );
    }

    const broker = getLogBroker();
    const ids: string[] = [];

    for (const item of body) {
      if (typeof item !== "object" || item === null) continue;
      const raw = item as Record<string, unknown>;

      let message: string | undefined;
      if (typeof raw.message === "string") message = raw.message;
      else if (typeof raw.msg === "string") message = raw.msg;
      if (!message) continue;

      const level = typeof raw.level === "string" ? raw.level : undefined;
      const clientId = typeof raw.clientId === "string" ? raw.clientId : undefined;
      const ts = typeof raw.ts === "string" ? raw.ts : undefined;

      const entry = broker.append({
        message,
        level: normalizeLevel(level),
        ...(clientId ? { clientId } : {}),
        ...(ts ? { ts } : {}),
      });
      ids.push(entry.id);
    }

    return NextResponse.json({ ok: true, count: ids.length, ids }, { status: 202 });
  } catch (e) {
    console.error("ingest/batch POST error:", e);
    return NextResponse.json(
      { error: "Failed to ingest batch" },
      { status: 500 },
    );
  }
}
