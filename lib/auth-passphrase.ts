import { parsePassphrasesFromEnv } from "@/lib/auth-config";

/** Edge-safe constant-time compare for equal-length buffers. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

let cachedDigestList: Uint8Array[] | null = null;

async function getPassphraseDigests(): Promise<Uint8Array[]> {
  if (cachedDigestList) return cachedDigestList;
  const list = parsePassphrasesFromEnv();
  const out: Uint8Array[] = [];
  for (const p of list) {
    const buf = new TextEncoder().encode(p);
    const digest = await crypto.subtle.digest("SHA-256", buf);
    out.push(new Uint8Array(digest));
  }
  cachedDigestList = out;
  return out;
}

/**
 * True if `plain` matches one of the configured passphrases (SHA-256, timing-safe).
 * Safe for Edge middleware and Node route handlers.
 */
export async function verifyPassphrase(plain: string): Promise<boolean> {
  const digests = await getPassphraseDigests();
  if (digests.length === 0) return false;
  const buf = new TextEncoder().encode(plain);
  const input = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  for (const d of digests) {
    if (timingSafeEqual(input, d)) return true;
  }
  return false;
}
