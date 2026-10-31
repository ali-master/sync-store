import { describe, expect, test } from "bun:test";
import { SyncStore } from "../src/remote-storage";

const a = process.env.API_TEST_URL_A;
const b = process.env.API_TEST_URL_B;
const apiKey = process.env.API_TEST_KEY;
const adminKey = process.env.API_TEST_ADMIN_KEY;

/** Wait for actual delivery, rather than sleeping and assuming inter-node synchronization. */
async function eventually(check: () => boolean) {
  const deadline = Date.now() + 8000;
  while (!check() && Date.now() < deadline) await Bun.sleep(20);
  expect(check()).toBe(true);
}

describe.skipIf(!a || !b || !apiKey || !adminKey)("distributed Socket.IO", () => {
  test("cross-node delivery, tenant isolation, cluster session listing and remote disconnect", async () => {
    const userId = `cluster-${crypto.randomUUID()}`;
    const common = { apiKey: apiKey!, userId, autoConnect: false, timeout: 5000 };
    const writer = new SyncStore({
      ...common,
      serverUrl: a!,
      instanceId: "writer",
      mode: "websocket",
    });
    const reader = new SyncStore({
      ...common,
      serverUrl: b!,
      instanceId: "reader",
      mode: "websocket",
    });
    const http = new SyncStore({ ...common, serverUrl: a!, instanceId: "http", mode: "http" });
    const stranger = new SyncStore({
      ...common,
      userId: userId + "-other",
      serverUrl: b!,
      instanceId: "reader",
      mode: "websocket",
    });
    async function admin(origin: string, path: string, method = "GET") {
      const response = await fetch(origin + "/api/v1/admin/" + path, {
        method,
        headers: {
          authorization: "Bearer " + adminKey,
          "x-user-id": "cluster-test",
          "x-instance-id": "test",
        },
      });
      expect(response.ok).toBe(true);
      return (await response.json()).payload;
    }
    try {
      await Promise.all([writer.connect(), reader.connect(), http.connect(), stranger.connect()]);
      await writer.setItem("shared", false);
      await eventually(() => reader.getItem("shared") === false);
      await http.setItem("via-http", 0);
      await eventually(() => reader.getItem("via-http") === 0);
      expect(await stranger.getAllKeys()).toEqual([]);
      for (const origin of [a!, b!]) {
        const sessions = await admin(origin, "resources/sessions?userId=" + userId);
        expect(sessions.items.map((s: any) => s.instanceId).sort()).toEqual(["reader", "writer"]);
        expect(JSON.stringify(sessions)).not.toContain(apiKey!);
      }
      const sessions = await admin(a!, "resources/sessions?userId=" + userId);
      const remote = sessions.items.find((s: any) => s.instanceId === "reader");
      await admin(a!, `sessions/${remote._id}/disconnect`, "POST");
      await eventually(() => !reader.isConnected());
      await writer.removeItem("shared");
      await reader.connect();
      expect(await reader.hasItem("shared")).toBe(false);
      await writer.clear();
      await eventually(() => reader.getItem("via-http") === null);
    } finally {
      for (const client of [writer, reader, http, stranger]) client.destroy();
    }
  }, 30000);
});
