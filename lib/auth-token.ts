import { getJwtSecretBytes } from "@/lib/auth-config";
import { SignJWT, jwtVerify } from "jose";

const MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

export async function signSessionJwt(): Promise<string | null> {
  const key = getJwtSecretBytes();
  if (!key) return null;
  return new SignJWT({ sub: "logview" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SEC}s`)
    .sign(key);
}

export async function verifySessionJwt(token: string): Promise<boolean> {
  const key = getJwtSecretBytes();
  if (!key) return false;
  try {
    await jwtVerify(token, key);
    return true;
  } catch {
    return false;
  }
}

export { MAX_AGE_SEC };
