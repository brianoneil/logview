/** HttpOnly session cookie name (JWT). */
export const LV_SESSION_COOKIE = "lv_session";

const MIN_SECRET_LEN = 16;

export function isAuthDisabledInDev(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.LOGVIEW_AUTH_DISABLE === "true"
  );
}

/**
 * JSON array of passphrases, e.g. `["alpha","beta"]`.
 * Commas inside a passphrase are fine; use JSON.
 */
export function parsePassphrasesFromEnv(): string[] {
  const raw = process.env.LOGVIEW_AUTH_PASSPHRASES?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && x.length > 0);
  } catch {
    return [];
  }
}

export function getJwtSecretBytes(): Uint8Array | null {
  const s = process.env.LOGVIEW_AUTH_SECRET?.trim();
  if (!s || s.length < MIN_SECRET_LEN) return null;
  return new TextEncoder().encode(s);
}

export function isAuthFullyConfigured(): boolean {
  if (isAuthDisabledInDev()) return true;
  const pass = parsePassphrasesFromEnv();
  const secret = getJwtSecretBytes();
  return pass.length > 0 && secret !== null;
}
