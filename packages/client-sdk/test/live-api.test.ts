import { describe, expect, test } from "bun:test";
import { SyncStore } from "../src/remote-storage";

describe.skipIf(!process.env.API_TEST_URL || !process.env.API_TEST_KEY)(
  "live API synchronization",
  () => {
    test("HTTP writes reach a WebSocket peer and deletion reconciles after reconnect", async () => {
      const userId = "client-integration-" + crypto.randomUUID();
      const common = {
        serverUrl: process.env.API_TEST_URL!,
        apiKey: process.env.API_TEST_KEY!,
        userId,
        autoConnect: false,
        timeout: 3000,
      };
      const writer = new SyncStore({ ...common, instanceId: "http", mode: "http" });
      const reader = new SyncStore({ ...common, instanceId: "ws", mode: "websocket" });
      try {
        await writer.connect();
        await reader.connect();
        expect(await reader.hasItem("absent")).toBe(false);
        await writer.setItem("shared", false);
        const deadline = Date.now() + 3000;
        while (reader.getItem("shared") !== false && Date.now() < deadline) await Bun.sleep(10);
        expect(reader.getItem("shared")).toBe(false);
        await writer.setItem("empty", "");
        await writer.setItem("nullable", null);
        expect(
          (await writer.getAllItems()).find((item) => item.key === "nullable")?.value,
        ).toBeNull();
        reader.disconnect();
        await writer.removeItem("shared");
        await reader.connect();
        expect(await reader.hasItem("shared")).toBe(false);
        writer.disconnect();
        await writer.setItem("queued", { delivered: true });
        expect(reader.getItem("queued")).toBeNull();
        await writer.connect();
        const queuedDeadline = Date.now() + 3000;
        while (reader.getItem("queued") === null && Date.now() < queuedDeadline)
          await Bun.sleep(10);
        expect(reader.getItem("queued")).toEqual({ delivered: true });
        await writer.clear();
      } finally {
        writer.destroy();
        reader.destroy();
      }
    }, 15_000);
    test("invalid credentials cannot establish an HTTP session", async () => {
      const client = new SyncStore({
        serverUrl: process.env.API_TEST_URL!,
        apiKey: "invalid-e2e-key",
        userId: "unauthorized-e2e",
        instanceId: "http",
        mode: "http",
        autoConnect: false,
        timeout: 3000,
      });
      try {
        await expect(client.connect()).rejects.toThrow();
        expect(client.isConnected()).toBe(false);
      } finally {
        client.destroy();
      }
    });
  },
);
