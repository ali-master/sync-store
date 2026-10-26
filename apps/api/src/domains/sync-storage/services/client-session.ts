import { createHmac, timingSafeEqual } from "node:crypto";
import { UnauthorizedException } from "@nestjs/common";

export interface ClientSession {
  keyId: string;
  userId: string;
  branch: string;
  expiresAt: number;
}

/** Delegate a parent key to one authenticated user and branch for at most fifteen minutes. */
export function issueClientSession(
  key: { id: string; key: string; expiresAt?: Date | null },
  userId: string,
  branch: string,
  now = Date.now(),
) {
  const expiresAt = Math.min(now + 15 * 60_000, key.expiresAt?.getTime() ?? Infinity);
  if (expiresAt <= now) throw new UnauthorizedException("API key has expired");
  const body = Buffer.from(JSON.stringify({ keyId: key.id, userId, branch, expiresAt })).toString(
    "base64url",
  );
  return { token: `ss_session.${body}.${signature(body, key.key)}`, expiresAt };
}

/** Decode only to locate the parent record. Authorization must verify the signature afterward. */
export function readClientSession(token: string): ClientSession {
  try {
    if (token.length > 4096) throw new Error();
    const [prefix, body, mac, extra] = token.split(".");
    const data = JSON.parse(Buffer.from(body, "base64url").toString());
    if (
      prefix !== "ss_session" ||
      !mac ||
      extra !== undefined ||
      typeof data.keyId !== "string" ||
      typeof data.userId !== "string" ||
      !data.userId ||
      data.userId.length > 128 ||
      typeof data.branch !== "string" ||
      !Number.isSafeInteger(data.expiresAt)
    )
      throw new Error();
    return data;
  } catch {
    throw new UnauthorizedException("Invalid client session");
  }
}

/** Recheck expiry and the current parent secret so rotation immediately revokes delegated sessions. */
export function verifyClientSession(token: string, key: string, now = Date.now()): ClientSession {
  const data = readClientSession(token);
  const [, body, mac] = token.split(".");
  const expected = Buffer.from(signature(body, key));
  const received = Buffer.from(mac);
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received) ||
    data.expiresAt <= now
  )
    throw new UnauthorizedException("Invalid or expired client session");
  return data;
}

/** Bind the complete encoded claim set to the server-held API credential. */
function signature(body: string, key: string): string {
  return createHmac("sha256", key)
    .update("sync-store-client-session:" + body)
    .digest("base64url");
}
