import {
  isAuthDisabledInDev,
  isAuthFullyConfigured,
} from "@/lib/auth-config";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/status — public. Tells the login UI whether auth is configured
 * or disabled in dev (no secrets exposed).
 */
export async function GET() {
  if (isAuthDisabledInDev()) {
    return NextResponse.json({
      disabled: true,
      configured: true,
    });
  }

  return NextResponse.json({
    disabled: false,
    configured: isAuthFullyConfigured(),
  });
}
