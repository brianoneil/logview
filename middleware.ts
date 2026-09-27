import {
  isAuthDisabledInDev,
  isAuthFullyConfigured,
} from "@/lib/auth-config";
import { isAuthorizedRequest } from "@/lib/authorize-request";
import { type NextRequest, NextResponse } from "next/server";

function authNotConfiguredResponse(request: NextRequest) {
  const isApi = request.nextUrl.pathname.startsWith("/api/");
  if (isApi) {
    return NextResponse.json(
      {
        error:
          "Auth not configured. Set LOGVIEW_AUTH_SECRET (16+ chars) and LOGVIEW_AUTH_PASSPHRASES (JSON array of strings).",
      },
      { status: 503 },
    );
  }
  return new NextResponse(
    "Logview auth is not configured. Set LOGVIEW_AUTH_SECRET (16+ chars) and LOGVIEW_AUTH_PASSPHRASES (JSON array of strings).",
    { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
}

async function isAuthorized(request: NextRequest): Promise<boolean> {
  return isAuthorizedRequest(request.headers);
}

export async function middleware(request: NextRequest) {
  if (isAuthDisabledInDev()) {
    return NextResponse.next();
  }

  if (!isAuthFullyConfigured()) {
    return authNotConfiguredResponse(request);
  }

  if (await isAuthorized(request)) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Unauthorized", hint: "Sign in in the browser or send Authorization: Bearer <passphrase>." },
      { status: 401 },
    );
  }

  const login = new URL("/login", request.url);
  login.searchParams.set(
    "next",
    `${pathname}${request.nextUrl.search}`,
  );
  return NextResponse.redirect(login);
}

/** Ingest stays public so services can POST/GET logs without a token. Viewer + docs + SSE remain protected. */
export const config = {
  matcher: ["/", "/usage", "/usage/:path*", "/api/stream"],
};
