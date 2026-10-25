import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import { ensureBootstrapKey, BOOTSTRAP_KEY_ID } from "../../src/domains/admin/bootstrap-key";
import { keySettings, identifier } from "../../src/domains/admin/admin.validation";
import { SyncStorageGateway } from "../../src/domains/sync-storage/gateways/sync-storage.gateway";

test("console sessions follow the live socket lifecycle without exposing metadata", async () => {
  let sockets = [
    {
      id: "socket",
      data: {
        identity: { userId: "user", instanceId: "browser" },
        connectedAt: Date.now(),
        apiKey: "private",
      },
    },
  ];
  const snapshot = () =>
    SyncStorageGateway.prototype.getSessions.call({
      server: { fetchSockets: async () => sockets },
    } as any);
  expect(await snapshot()).toHaveLength(1);
  expect((await snapshot())[0]._id).toBe("socket");
  expect(JSON.stringify(await snapshot())).not.toContain("private");
  sockets = [];
  expect(await snapshot()).toEqual([]);
});

describe("administrator bootstrap", () => {
  test("creates one random administrator across concurrent starts and restarts", async () => {
    let record: any = null;
    const db = {
      orm: {
        api_keys: {
          where: () => ({ first: async () => record }),
          create: async (value: any) => {
            if (record) throw new Error("duplicate id");
            record = value;
          },
        },
      },
    };
    const results = await Promise.all([
      ensureBootstrapKey(db as any),
      ensureBootstrapKey(db as any),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(record.id).toBe(BOOTSTRAP_KEY_ID);
    expect(record.key).toMatch(/^ss_admin_[a-f0-9]{64}$/);
    expect(JSON.parse(record.scopes)).toContain("admin");
    expect(await ensureBootstrapKey(db as any)).toBeNull();
    expect(results).toContain(record.key);
  });
  test("does not swallow database failures", async () => {
    const db = {
      orm: {
        api_keys: {
          where: () => ({ first: async () => null }),
          create: async () => {
            throw new Error("database unavailable");
          },
        },
      },
    };
    await expect(ensureBootstrapKey(db as any)).rejects.toThrow("database unavailable");
  });
});

describe("administrator input boundary", () => {
  test("rejects scope escalation, secret injection and invalid limits", () => {
    for (const input of [
      { scopes: ["admin"] },
      { key: "injected" },
      { minuteQuota: -1 },
      { canWrite: "true" },
      { allowedMethods: ["EXEC"] },
      { expiresAt: "not-a-date" },
    ]) {
      expect(() => keySettings(input)).toThrow();
    }
    expect(() => identifier({ $ne: null }, "id")).toThrow();
  });
  test("normalizes only allowed settings", () => {
    expect(
      keySettings({ name: " App ", canWrite: false, minuteQuota: null, allowedMethods: ["GET"] }),
    ).toEqual({ name: "App", canWrite: false, minuteQuota: null, allowedMethods: '["GET"]' });
  });
});
