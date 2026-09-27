import {
  isAuthDisabledInDev,
  isAuthFullyConfigured,
  LV_SESSION_COOKIE,
} from "./auth-config";
import { verifyPassphrase } from "./auth-passphrase";
import { verifySessionJwtEdge } from "./auth-jwt-edge";

function sessionCookieFromHeader(cookieHeader: string): string | undefined {
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === LV_SESSION_COOKIE) {
      const value = part.slice(eq + 1).trim();
      return value.length > 0 ? value : undefined;
    }
  }
  return undefined;
}

/**
 * Shared authorization check for viewer/stream-style routes: a valid `lv_session`
 * cookie, or `Authorization: Bearer <passphrase>`, or auth disabled in dev.
 * Works on plain `Request` headers, so route handlers can reuse the exact
 * middleware logic (the Edge matcher only covers a fixed path list).
 */
export async function isAuthorizedRequest(
  headers: Headers,
): Promise<boolean> {
  if (isAuthDisabledInDev()) return true;
  if (!isAuthFullyConfigured()) return false;

  const cookieHeader = headers.get("cookie");
  if (cookieHeader) {
    const cookie = sessionCookieFromHeader(cookieHeader);
    if (cookie && (await verifySessionJwtEdge(cookie))) return true;
  }

  const auth = headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length);
    if (await verifyPassphrase(token)) return true;
  }

  return false;
}
