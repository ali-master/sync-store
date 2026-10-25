import "reflect-metadata";
import { expect, test } from "bun:test";
import { Database } from "../../src/modules/db/db.client";
import { apiKeyData } from "../../src/modules/db/api-key-data";
import { quotaWindows } from "../../src/domains/sync-storage/services/quota-window";
import { io } from "socket.io-client";

test.skipIf(!process.env.TEST_TLS_URL)(
  "verified TLS, forged headers, WSS and shared quotas across replicas",
  async () => {
    const db = new Database();
    await db.onModuleInit();
    const data = { ...apiKeyData("TLS cluster QA", crypto.randomUUID()), requireHttps: true };
    await db.orm.api_keys.create(data);
    const keys = db.native.collection<any>("api_keys");
    const ca = await Bun.file(process.env.TEST_TLS_CA!).text();
    const headers = { "x-api-key": data.key, "x-user-id": data.id, "x-instance-id": "tls-qa" };
    const peers = new Set<string>();
    const request = async (url = process.env.TEST_TLS_URL!, extra = {}) => {
      const result = await fetch(url + "/api/v1/keys", {
        headers: { ...headers, ...extra },
        tls: { ca },
      });
      const peer = result.headers.get("x-qa-upstream");
      if (peer) peers.add(peer);
      await result.text();
      return result.status;
    };
    try {
      expect(await request()).toBe(200);
      expect(await request(process.env.TEST_HTTP_URL!, { "x-forwarded-proto": "https" })).toBe(403);
      for (const url of process.env.TEST_REPLICA_URLS!.split(","))
        expect(
          await request(url, { "x-forwarded-proto": "https", "x-forwarded-for": "127.0.0.1" }),
        ).toBe(403);
      // A trusted edge replaces forged client headers rather than appending to them.
      await keys.updateOne({ _id: data.id }, { $set: { ipRestrictions: '["127.0.0.1"]' } });
      expect(await request(undefined, { "x-forwarded-for": "127.0.0.1" })).toBe(403);
      await keys.updateOne({ _id: data.id }, { $set: { ipRestrictions: "[]" } });
      await new Promise<void>((resolve, reject) => {
        const socket = io(process.env.TEST_TLS_URL + "/sync", {
          transports: ["websocket"],
          ca,
          reconnection: false,
          timeout: 5000,
          auth: { apiKey: data.key, userId: data.id, instanceId: "tls-socket" },
        });
        const timeout = setTimeout(() => {
          socket.close();
          reject(new Error("WSS timeout"));
        }, 8000);
        socket.on("connect", () =>
          socket.emit("sync:getAll", {}, (reply: any) => {
            clearTimeout(timeout);
            socket.close();
            if (reply.type === "error") reject(new Error(JSON.stringify(reply)));
            else resolve();
          }),
        );
        socket.on("connect_error", (error) => {
          clearTimeout(timeout);
          socket.close();
          reject(error);
        });
      });
      for (const window of quotaWindows) {
        await keys.updateOne(
          { _id: data.id },
          {
            $set: {
              minuteQuota: null,
              hourQuota: null,
              dailyQuota: null,
              monthlyQuota: null,
              [window.limit]: 20,
              [window.counter]: 999,
              [`quotaWindow_${window.unit}`]: new Date(0),
            },
          },
        );
        const statuses = await Promise.all(Array.from({ length: 60 }, () => request()));
        expect(statuses.filter((status) => status === 200)).toHaveLength(20);
        expect(statuses.filter((status) => status === 403)).toHaveLength(40);
        expect((await keys.findOne({ _id: data.id }))![window.counter]).toBe(20);
        console.log(`${window.unit}: 20 admitted / 40 rejected; exact shared counter 20`);
      }
      expect(peers.size).toBe(2);
      console.log("TLS verified, WSS operation passed, forged headers rejected; upstreams:", [
        ...peers,
      ]);
    } finally {
      await keys.deleteOne({ _id: data.id });
      await db.onApplicationShutdown();
    }
  },
  30000,
);
