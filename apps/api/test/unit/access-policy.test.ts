import "reflect-metadata";
import { expect, test } from "bun:test";
import {
  accessPolicy,
  permits,
  projectUser,
  validateAccess,
} from "../../src/domains/sync-storage/services/access-policy";
import { ApiKeyGuard } from "../../src/domains/sync-storage/guards/api-key.guard";

test("project namespaces cannot be forged and prefix permissions remain case sensitive", () => {
  expect(projectUser("default", "alice")).toBe("alice");
  expect(projectUser("one", "alice")).not.toBe(projectUser("two", "alice"));
  expect(() => projectUser("default", projectUser("one", "alice"))).toThrow("Reserved");
  const policy = validateAccess({
    projectId: "one",
    readPrefixes: ["settings/"],
    writePrefixes: ["orders/"],
  });
  expect(permits(policy, "settings/theme", true)).toBe(true);
  expect(permits(policy, "Settings/theme", true)).toBe(false);
  expect(permits(policy, "settings/theme", false)).toBe(false);
  expect(() => validateAccess({ ...policy, readPrefixes: ["*"] })).toThrow();
  expect(accessPolicy({}).projectId).toBe("default");
});

test("authorization rejects disallowed paths and refreshes event permissions after revocation", async () => {
  const row: any = {
    id: "key",
    key: "secret",
    isActive: true,
    canRead: true,
    canWrite: true,
    allowedMethods: '["GET","PUT","DELETE"]',
    metadata: JSON.stringify({
      access: { projectId: "one", readPrefixes: ["settings/"], writePrefixes: ["orders/"] },
    }),
  };
  const guard = new ApiKeyGuard({
    orm: { api_keys: { where: () => ({ first: async () => row }) } },
    native: { collection: () => ({ updateOne: async () => ({ matchedCount: 1 }) }) },
  } as any);
  const request: any = {
    headers: { "x-api-key": "secret", "x-user-id": "alice", "x-instance-id": "test" },
    method: "GET",
    params: { key: "settings/theme" },
    query: {},
    socket: {},
  };
  await guard.authorize(request);
  expect(request.storageUserId).toBe(projectUser("one", "alice"));
  request.params.key = "orders/private";
  await expect(guard.authorize(request)).rejects.toThrow("permitted prefixes");
  request.method = "DELETE";
  request.params = {};
  await expect(guard.authorize(request)).rejects.toThrow("Bulk operations");
  const { createHash } = await import("node:crypto");
  const data = {
    apiKeyId: "key",
    credentialHash: createHash("sha256").update("secret").digest("hex"),
  };
  expect(await guard.canReceive(data, "settings/theme")).toBe(true);
  expect(await guard.canReceive(data, "orders/private")).toBe(false);
  row.canRead = false;
  expect(await guard.canReceive(data, "settings/theme")).toBe(false);
});
