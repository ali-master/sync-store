import { expect, test } from "bun:test";
import {
  issueClientSession,
  verifyClientSession,
} from "../../src/domains/sync-storage/services/client-session";

const key = { id: "application", key: "server-only-secret" };
test("delegated sessions bind identity, expire and cannot survive secret rotation", () => {
  const session = issueClientSession(key, "customer-a", "main", 1000);
  expect(verifyClientSession(session.token, key.key, 1001)).toEqual({
    keyId: key.id,
    userId: "customer-a",
    branch: "main",
    expiresAt: 901000,
  });
  expect(() => verifyClientSession(session.token, key.key, 901000)).toThrow("expired");
  expect(() => verifyClientSession(session.token, "rotated", 1001)).toThrow("Invalid");
  const [, body, mac] = session.token.split(".");
  const changed = Buffer.from(
    JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), userId: "victim" }),
  ).toString("base64url");
  expect(() => verifyClientSession(`ss_session.${changed}.${mac}`, key.key, 1001)).toThrow(
    "Invalid",
  );
});
test("session lifetime never exceeds the parent credential", () => {
  const session = issueClientSession({ ...key, expiresAt: new Date(2000) }, "user", "main", 1000);
  expect(session.expiresAt).toBe(2000);
});
