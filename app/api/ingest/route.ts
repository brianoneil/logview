import { getLogBroker, normalizeLevel } from "@/lib/log-broker";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * POST /api/ingest
 * Body: application/json { message, level?, clientId?, ts? } or text/plain (message only).
 */
export async function POST(request: Request) {
  try {
    const ct = request.headers.get("content-type") ?? "";

    let message: string | undefined;
    let level: string | undefined;
    let clientId: string | undefined;
    let ts: string | undefined;

    if (ct.includes("application/json")) {
      const body = (await request.json()) as Record<string, unknown>;
      if (typeof body.message === "string") message = body.message;
      else if (typeof body.msg === "string") message = body.msg;
      level = typeof body.level === "string" ? body.level : undefined;
      clientId = typeof body.clientId === "string" ? body.clientId : undefined;
      ts = typeof body.ts === "string" ? body.ts : undefined;
    } else if (ct.includes("text/plain")) {
      message = await request.text();
    } else {
      return badRequest(
        "Supported Content-Types: application/json, text/plain",
      );
    }

    if (message === undefined || message === "") {
      return badRequest("message is required");
    }

    const entry = getLogBroker().append({
      message,
      level: normalizeLevel(level),
      ...(clientId ? { clientId } : {}),
      ...(ts ? { ts } : {}),
    });

    return NextResponse.json({ ok: true, id: entry.id }, { status: 202 });
  } catch (e) {
    console.error("ingest POST error:", e);
    return NextResponse.json(
      { error: "Failed to ingest log" },
      { status: 500 },
    );
  }
}

/**
 * GET /api/ingest?message=...&level=info&clientId=...&ts=...
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const message = searchParams.get("message") ?? searchParams.get("m");
    if (!message) {
      return badRequest("message (or m) query parameter is required");
    }
    const level = searchParams.get("level") ?? undefined;
    const clientId = searchParams.get("clientId") ?? undefined;
    const ts = searchParams.get("ts") ?? undefined;

    const entry = getLogBroker().append({
      message,
      level: normalizeLevel(level),
      ...(clientId ? { clientId } : {}),
      ...(ts ? { ts } : {}),
    });

    return NextResponse.json({ ok: true, id: entry.id }, { status: 202 });
  } catch (e) {
    console.error("ingest GET error:", e);
    return NextResponse.json(
      { error: "Failed to ingest log" },
      { status: 500 },
    );
  }
}
