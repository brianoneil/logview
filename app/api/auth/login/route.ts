import {
  isAuthDisabledInDev,
  isAuthFullyConfigured,
  LV_SESSION_COOKIE,
} from "@/lib/auth-config";
import { verifyPassphrase } from "@/lib/auth-passphrase";
import { MAX_AGE_SEC, signSessionJwt } from "@/lib/auth-token";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (isAuthDisabledInDev()) {
    return NextResponse.json(
      { error: "Auth is disabled (LOGVIEW_AUTH_DISABLE in development)." },
      { status: 400 },
    );
  }

  if (!isAuthFullyConfigured()) {
    return NextResponse.json(
      { error: "Auth is not configured on the server." },
      { status: 503 },
    );
  }

  let passphrase = "";
  try {
    const body = (await request.json()) as { passphrase?: unknown };
    if (typeof body.passphrase === "string") passphrase = body.passphrase;
  } catch {
    return NextResponse.json({ error: "Expected JSON body." }, { status: 400 });
  }

  if (!(await verifyPassphrase(passphrase))) {
    return NextResponse.json({ error: "Invalid passphrase." }, { status: 401 });
  }

  const token = await signSessionJwt();
  if (!token) {
    return NextResponse.json(
      { error: "Could not create session (check LOGVIEW_AUTH_SECRET)." },
      { status: 500 },
    );
  }

  const res = NextResponse.json({ ok: true });
  const secure = process.env.NODE_ENV === "production";
  res.cookies.set(LV_SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SEC,
  });
  return res;
}
