import { issueClientSession } from "../../src/domains/sync-storage/services/client-session";
import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import { ApiKeyGuard } from "../../src/domains/sync-storage/guards/api-key.guard";

/** Verify denied requests never reach the usage update or storage handlers. */
function guard(record: Record<string, any> | null) {
  let updates = 0;
  const service = {
    orm: { api_keys: { where: () => ({ first: async () => record }) } },
    native: {
      collection: () => ({
        updateOne: async () => {
          updates++;
          return { matchedCount: 1 };
        },
      }),
    },
  };
  return { guard: new ApiKeyGuard(service as any), updates: () => updates };
}
const active = {
  id: "key",
  isActive: true,
  canRead: true,
  canWrite: true,
  allowedMethods: '["GET","PUT","DELETE"]',
};
const request = (method = "GET") =>
  ({
    headers: { "x-api-key": "secret", "x-user-id": "user", "x-instance-id": "instance" },
    method,
    query: {},
    params: {},
    protocol: "http",
    ip: "127.0.0.1",
  }) as any;

describe("API key trust boundary", () => {
  test("rejects unknown keys", async () => {
    const f = guard(null);
    await expect(f.guard.authorize(request())).rejects.toThrow("Invalid");
    expect(f.updates()).toBe(0);
  });
  test("rejects writes with read-only credentials", async () => {
    const f = guard({ ...active, canWrite: false });
    await expect(f.guard.authorize(request("PUT"))).rejects.toThrow("Write permission");
    expect(f.updates()).toBe(0);
  });
  test("rejects missing user identity", async () => {
    const f = guard(active);
    const req = request();
    delete req.headers["x-user-id"];
    await expect(f.guard.authorize(req)).rejects.toThrow("identifiers");
  });
  test("rejects expired credentials", async () => {
    const f = guard({ ...active, expiresAt: new Date(0) });
    await expect(f.guard.authorize(request())).rejects.toThrow("expired");
  });
  test("socket identity is bound to authenticated handshake and ignores message identity", async () => {
    const f = guard(active);
    const socket = {
      data: {},
      handshake: {
        auth: { apiKey: "secret", userId: "owner", instanceId: "instance" },
        query: {},
        headers: {},
        address: "127.0.0.1",
        secure: false,
      },
    } as any;
    await f.guard.authorizeSocket(socket);
    await f.guard.authorizeSocket(socket, "PUT", {
      userId: "victim",
      instanceId: "other",
      key: "key",
    });
    expect(socket.data.identity).toEqual({ userId: "owner", instanceId: "instance" });
  });
});

test("session guard rejects impersonation, delegation and admin scope", async () => {
  const record = { ...active, key: "secret" };
  const f = guard(record);
  const issued = issueClientSession(record, "user", "main");
  const req = request();
  req.headers["x-api-key"] = issued.token;
  await expect(f.guard.authorize(req)).resolves.toBe(true);
  req.headers["x-user-id"] = "victim";
  await expect(f.guard.authorize(req)).rejects.toThrow("identity");
  req.headers["x-user-id"] = "user";
  await expect(f.guard.authorize(req, "admin")).rejects.toThrow("administer");
  req.url = "/api/v1/client-sessions";
  await expect(f.guard.authorize(req)).rejects.toThrow("delegate");
});

test("expired browser sessions cannot receive events on an existing socket", async () => {
  const f = guard({ ...active, key: "secret" });
  expect(
    await f.guard.canReceive(
      { apiKeyId: "key", credentialHash: "hash", sessionExpiresAt: Date.now() - 1 },
      "key",
    ),
  ).toBe(false);
});
