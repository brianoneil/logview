import { isAuthDisabledInDev, LV_SESSION_COOKIE } from "@/lib/auth-config";
import { verifySessionJwt } from "@/lib/auth-token";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (isAuthDisabledInDev()) {
    return NextResponse.json({ ok: true, disabled: true });
  }

  const jar = await cookies();
  const token = jar.get(LV_SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ ok: false });
  }

  const ok = await verifySessionJwt(token);
  return NextResponse.json({ ok });
}
