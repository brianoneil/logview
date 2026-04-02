import { getJwtSecretBytes } from "@/lib/auth-config";

function base64UrlToBytes(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Verifies HS256 JWT (iss/exp) for Edge middleware — no jose dependency.
 */
export async function verifySessionJwtEdge(token: string): Promise<boolean> {
  const secret = getJwtSecretBytes();
  if (!secret) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [h64, p64, s64] = parts;
  if (!h64 || !p64 || !s64) return false;

  let header: { alg?: string };
  try {
    header = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(h64)),
    ) as { alg?: string };
  } catch {
    return false;
  }
  if (header.alg !== "HS256") return false;

  let payload: { exp?: number };
  try {
    payload = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(p64)),
    ) as { exp?: number };
  } catch {
    return false;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < nowSec) {
    return false;
  }

  const data = new TextEncoder().encode(`${h64}.${p64}`);
  const sig = base64UrlToBytes(s64);

  try {
    const rawKey = new Uint8Array(secret);
    const key = await crypto.subtle.importKey(
      "raw",
      rawKey,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const sigBuf = new Uint8Array(sig);
    return await crypto.subtle.verify(
      "HMAC",
      key,
      sigBuf as globalThis.BufferSource,
      data as globalThis.BufferSource,
    );
  } catch {
    return false;
  }
}
