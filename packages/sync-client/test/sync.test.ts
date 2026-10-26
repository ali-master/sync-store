import { afterEach, describe, expect, test } from "bun:test";
import { RemoteStorage } from "../src/remote-storage";
import { HttpTransport } from "../src/transport/http-transport";
import { TransportMode } from "../src/transport/types";
import { DataStorage } from "../src/utils/storage";

const resources: Array<{ destroy(): void }> = [];
const servers: Array<{ stop(force?: boolean): void }> = [];
test("memory storage enumerates writes and preserves null-valued keys", () => {
  const storage = new DataStorage({ namespace: crypto.randomUUID() });
  storage.setItem("empty", null);
  storage.setItem("false", false);
  expect(storage.getAllKeys().sort()).toEqual(["empty", "false"]);
  expect(storage.hasItem("empty")).toBe(true);
  storage.clear();
  expect(storage.getAllKeys()).toEqual([]);
});
afterEach(() => {
  resources.splice(0).forEach((r) => r.destroy());
  servers.splice(0).forEach((s) => s.stop(true));
});

/** Exercise the client against real HTTP requests without a production database. */
function fixture(basePath = "/api/v1") {
  const items = new Map<string, any>();
  const writes: string[] = [];
  let fail = false;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      if (request.headers.get("x-api-key") !== "test-key")
        return Response.json({ message: "Unauthorized" }, { status: 401 });
      const path = new URL(request.url).pathname;
      if (path === `${basePath}/keys`) return Response.json([...items.keys()]);
      if (path === `${basePath}/items`) return Response.json([...items.values()]);
      if (path === `${basePath}/clear`) {
        items.clear();
        writes.push("clear");
        return new Response(null, { status: 204 });
      }
      if (!path.startsWith(`${basePath}/item/`)) return new Response(null, { status: 404 });
      const key = decodeURIComponent(path.slice(`${basePath}/item/`.length));
      if (request.method === "PUT") {
        if (fail) return Response.json({ message: "Retry later" }, { status: 503 });
        const body = await request.json();
        const item = { key, ...body, timestamp: Date.now(), version: 1 };
        items.set(key, item);
        writes.push(`set:${key}:${JSON.stringify(body.value)}`);
        return Response.json(item);
      }
      if (request.method === "DELETE") {
        items.delete(key);
        writes.push(`remove:${key}`);
        return new Response(null, { status: 204 });
      }
      return items.has(key)
        ? Response.json(items.get(key))
        : Response.json({ message: "Missing" }, { status: 404 });
    },
  });
  servers.push(server);
  const config = {
    serverUrl: `http://localhost:${server.port}`,
    userId: crypto.randomUUID(),
    instanceId: "instance",
    apiKey: "test-key",
    mode: TransportMode.HTTP,
    autoConnect: false,
  };
  return {
    config,
    items,
    writes,
    fail: (value: boolean) => {
      fail = value;
    },
  };
}

describe("storage synchronization", () => {
  test("HTTP accepts an explicit API base path with a trailing slash", async () => {
    const f = fixture("/custom/api");
    const client = new RemoteStorage({
      ...f.config,
      serverUrl: `${f.config.serverUrl}/custom/api/`,
    });
    resources.push(client);
    await client.connect();
    await client.setItem("custom", 42);
    expect(f.items.get("custom").value).toBe(42);
  });

  test("HTTP mode uses API prefix, authentication headers and preserves falsy values", async () => {
    const f = fixture();
    const client = new RemoteStorage(f.config);
    resources.push(client);
    await client.connect();
    await client.setItem("false", false);
    await client.setItem("zero", 0);
    expect(f.items.get("false").value).toBe(false);
    expect(f.items.get("zero").value).toBe(0);
    expect(await client.hasItem("missing")).toBe(false);
  });

  test("offline set/remove ordering survives connection without resurrecting deleted values", async () => {
    const f = fixture();
    const client = new RemoteStorage(f.config);
    resources.push(client);
    await client.setItem("key", 1);
    await client.removeItem("key");
    await client.connect();
    expect(f.writes).toEqual(["set:key:1", "remove:key"]);
    expect(client.getItem("key")).toBeNull();
    expect(f.items.size).toBe(0);
  });

  test("failed writes remain queued and forceSync retries in order", async () => {
    const f = fixture();
    const client = new RemoteStorage(f.config);
    resources.push(client);
    await client.connect();
    f.fail(true);
    await expect(client.setItem("key", 2)).rejects.toThrow("Retry later");
    f.fail(false);
    await client.forceSync();
    expect(f.items.get("key").value).toBe(2);
  });

  test("clear propagates to server, including keys absent from local cache", async () => {
    const f = fixture();
    const client = new RemoteStorage(f.config);
    resources.push(client);
    await client.connect();
    f.items.set("remote", { key: "remote", value: 1 });
    await client.clear();
    await client.forceSync();
    expect(f.items.size).toBe(0);
  });

  test("concurrent writes to one key are sent in invocation order", async () => {
    const f = fixture();
    const client = new RemoteStorage(f.config);
    resources.push(client);
    await client.connect();
    await Promise.all([
      client.setItem("key", 1),
      client.setItem("key", 2),
      client.setItem("key", 3),
    ]);
    expect(f.writes).toEqual(["set:key:1", "set:key:2", "set:key:3"]);
  });

  test("batch reports partial failures and keeps duplicate-key operation identities", async () => {
    const f = fixture();
    const transport = new HttpTransport({ ...f.config, instanceId: "i" });
    resources.push(transport);
    f.fail(true);
    const operations = [
      { type: "set" as const, key: "key", value: 1 },
      { type: "remove" as const, key: "key" },
    ];
    const response = await transport.executeBatch(operations);
    expect(response.data?.success).toBe(false);
    expect(response.data?.operations[1].operation).toBe(operations[1]);
  });

  test("quota errors preserve existing data and replacement does not double-count size", () => {
    const storage = new DataStorage({ namespace: "quota", maxSize: 230 });
    resources.push(storage);
    storage.setItem("key", "original");
    storage.setItem("key", "replacement");
    expect(() => storage.setItem("another", "x".repeat(200))).toThrow();
    expect(storage.getItem("key")).toBe("replacement");
  });
});

test("branch clients send fixed HTTP identity and partition caches without changing main", async () => {
  const user = "branch-user",
    namespace = "tenant-project";
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      return Response.json({
        requestId: "test",
        payload: { branch: req.headers.get("x-branch"), path: new URL(req.url).pathname },
      });
    },
  });
  servers.push(server);
  const main = new RemoteStorage({
    userId: user,
    namespace,
    autoConnect: false,
    serverUrl: server.url.toString(),
  });
  resources.push(main);
  const feature = new RemoteStorage({
    userId: user,
    namespace,
    branch: "feature/a",
    autoConnect: false,
    serverUrl: server.url.toString(),
  });
  resources.push(feature);
  expect((main as any).outbox.namespace).toBe("tenant-project:outbox:branch-user");
  expect((feature as any).outbox.namespace).not.toBe((main as any).outbox.namespace);
  expect((feature as any).localStorage.namespace).not.toBe((main as any).localStorage.namespace);
  expect((await feature.getBranches()).branch).toBe("feature/a");
  expect((await main.getBranches()).branch).toBe("main");
});

test("readiness waits for a snapshot and can retry after a snapshot failure", async () => {
  const client = new RemoteStorage({ userId: crypto.randomUUID(), autoConnect: false });
  resources.push(client);
  const internal = client as any;
  let snapshots = 0;
  internal.transport.destroy();
  internal.transport = {
    connect: async () => {},
    isConnected: () => true,
    getAllItems: async () =>
      ++snapshots === 1
        ? { success: false, error: "Snapshot unavailable" }
        : { success: true, data: [] },
    subscribe: async () => {},
    disconnect() {},
    destroy() {},
  };
  await expect(client.ready()).rejects.toThrow("Snapshot unavailable");
  expect(client.getStatus().ready).toBe(false);
  await client.ready();
  expect(snapshots).toBe(2);
  expect(client.getStatus().state).toBe("synced");
});

test("queued work, failed delivery, acknowledgement and shutdown have distinct states", async () => {
  const f = fixture();
  const client = new RemoteStorage(f.config);
  resources.push(client);
  await client.setItem("draft", false);
  expect(client.getStatus()).toMatchObject({
    state: "offline",
    pendingCount: 1,
    lastAcknowledgedAt: null,
  });
  await expect(client.close({ flush: true })).rejects.toThrow("offline");
  await client.ready();
  expect(client.getStatus()).toMatchObject({ state: "synced", ready: true, pendingCount: 0 });
  expect(client.getStatus().lastAcknowledgedAt).toBeNumber();
  f.fail(true);
  await expect(client.setItem("draft", 2)).rejects.toThrow();
  expect(client.getStatus()).toMatchObject({ state: "error", pendingCount: 1 });
  f.fail(false);
  await client.flush();
  expect(client.getStatus()).toMatchObject({ state: "synced", pendingCount: 0, error: null });
  await client.close({ flush: true });
  expect(client.getStatus().state).toBe("closed");
  await expect(client.setItem("draft", 3)).rejects.toThrow("closed");
});

test("flush never reports delivery after a disconnect leaves queued operations", async () => {
  const client = new RemoteStorage({ userId: crypto.randomUUID(), autoConnect: false });
  resources.push(client);
  await client.setItem("one", 1);
  await client.setItem("two", 2);
  const internal = client as any;
  internal.transport.destroy();
  let connected = true;
  internal.transport = {
    isConnected: () => connected,
    setItem: async () => {
      connected = false;
      return { success: true };
    },
    disconnect() {},
    destroy() {},
  };
  await expect(client.flush()).rejects.toThrow("Disconnected");
  expect(client.getStatus().pendingCount).toBe(1);
});

test("invalid JSON and schema values never enter the outbox or optimistic cache", async () => {
  const client = new RemoteStorage<{ count: number }>({
    userId: crypto.randomUUID(),
    autoConnect: false,
    schema: {
      count: (value) => {
        if (typeof value !== "number") throw new Error("Count must be a number");
      },
    },
  });
  resources.push(client);
  await expect(client.setItem("count", "wrong" as any)).rejects.toThrow("number");
  await expect(client.setItem("count", NaN)).rejects.toThrow("JSON");
  expect(client.getStatus().pendingCount).toBe(0);
  expect(client.getItem("count")).toBeNull();
});

test("bootstrap is scoped, preserves null, and does not claim server acknowledgement", async () => {
  const identity = { userId: "bootstrap-user", namespace: crypto.randomUUID(), autoConnect: false };
  const source = new RemoteStorage(identity);
  resources.push(source);
  await (source as any).handleRemoteUpdate({
    key: "empty",
    value: null,
    type: "sync",
    timestamp: 1,
    source: "remote",
  });
  const snapshot = source.dehydrate();
  const browser = new RemoteStorage({ ...identity, initialSnapshot: snapshot });
  resources.push(browser);
  expect(await browser.hasItem("empty")).toBe(true);
  expect(browser.getStatus()).toMatchObject({
    ready: false,
    lastAcknowledgedAt: null,
    pendingCount: 0,
  });
  expect(
    () => new RemoteStorage({ ...identity, userId: "other-user", initialSnapshot: snapshot }),
  ).toThrow("scope");
  await source.setItem("draft", "pending");
  expect(source.dehydrate().items.some((item) => item.key === "draft")).toBe(false);
});
