import { describe, expect, test } from "bun:test";
import { MongoClient } from "mongodb";
import { io, type Socket } from "socket.io-client";
import { SyncStore } from "../../../../packages/client-sdk/src/remote-storage";

describe.skipIf(!process.env.TEST_API_URL || !process.env.TEST_DATABASE_URL)(
  "project access over HTTP and Socket.IO",
  () => {
    test("projects isolate users and restricted readers never receive private keys", async () => {
      const db = await new MongoClient(process.env.TEST_DATABASE_URL!).connect();
      const base = process.env.TEST_API_URL!;
      const user = `test-${crypto.randomUUID()}`;
      let admin = (
        await db
          .db()
          .collection("api_keys")
          .findOne({ _id: "sync-store-bootstrap-admin" as any })
      )?.key;
      const call = async (
        key: string,
        path: string,
        method = "GET",
        body?: unknown,
        requestId?: string,
      ) => {
        const origin =
          method === "PUT" && path.startsWith("item/")
            ? process.env.TEST_WRITE_API_URL || base
            : base;
        const response = await fetch(`${origin}/api/v1/${path}`, {
          method,
          headers: {
            "x-api-key": key,
            Authorization: "Bearer " + key,
            "x-user-id": user,
            "x-instance-id": "test",
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
            ...(requestId ? { "Idempotency-Key": requestId } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const text = await response.text();
        return { status: response.status, data: text ? JSON.parse(text).payload : null };
      };
      const sockets: Socket[] = [];
      try {
        if (!admin) {
          const setup = await db
            .db()
            .collection("installation_setup")
            .findOne({ _id: "initial" as any });
          const response = await call("", "setup", "POST", {
            code: setup?.code,
            name: "Feature QA",
          });
          admin = response.data?.key;
        }
        if (!admin) throw new Error("Test installation administrator unavailable");
        const project = await call(admin, "admin/projects", "POST", { name: user });
        expect(project.status).toBe(201);
        const projectId = project.data._id;
        const createKey = async (
          projectId: string,
          readPrefixes: string[] = [],
          writePrefixes: string[] = [],
        ) => {
          const result = await call(admin, "admin/keys", "POST", {
            name: user,
            canRead: true,
            canWrite: true,
            access: { projectId, readPrefixes, writePrefixes },
          });
          expect(result.status).toBe(201);
          return result.data;
        };
        const full = await createKey(projectId);
        const restricted = await createKey(projectId, ["public/"], ["public/"]);
        const other = await createKey("default");
        const events: any[] = [];
        const socket = io(`${base}/sync`, {
          transports: ["websocket"],
          forceNew: true,
          auth: { userId: user, instanceId: "reader", apiKey: restricted.key },
        });
        sockets.push(socket);
        await new Promise<void>((resolve, reject) => {
          socket.once("connect", resolve);
          socket.once("connect_error", reject);
        });
        socket.on("sync:update", (event) => events.push(event));
        expect(
          (await call(full.key, "item/private", "PUT", { value: "secret" }, "private-write"))
            .status,
        ).toBe(200);
        expect(
          (await call(full.key, "item/public%2Ftheme", "PUT", { value: "dark" }, "public-write"))
            .status,
        ).toBe(200);
        expect((await call(other.key, "keys")).data).toEqual([]);
        expect((await call(restricted.key, "keys")).data).toEqual(["public/theme"]);
        expect((await call(restricted.key, "item/private")).status).toBe(403);
        expect((await call(restricted.key, "clear", "DELETE")).status).toBe(403);
        const list = await socket.timeout(3000).emitWithAck("sync:getAll", {});
        expect(list.items.map((item: any) => item.key)).toEqual(["public/theme"]);
        for (let attempt = 0; attempt < 40 && !events.length; attempt++) await Bun.sleep(50);
        expect(events.map((event) => event.key)).toEqual(["public/theme"]);
        const replay = await call(
          full.key,
          "item/public%2Ftheme",
          "PUT",
          { value: "dark" },
          "public-write",
        );
        expect(replay.data.version).toBe(1);
        expect(
          (await call(full.key, "item/public%2Ftheme", "PUT", { value: "changed" }, "public-write"))
            .status,
        ).toBe(409);
        await call(admin, `admin/keys/${restricted.id}`, "PATCH", { isActive: false });
        expect(
          (await call(full.key, "item/public%2Ftheme", "PUT", { value: "light" }, "public-write-2"))
            .status,
        ).toBe(200);
        await Bun.sleep(400);
        expect(events).toHaveLength(1);
        const versions = await call(full.key, "history/public%2Ftheme");
        expect(versions.status).toBe(200);
        expect(versions.data).toHaveLength(2);
        const revision = versions.data.find((row: any) => row.version === 1)._id;
        expect((await call(other.key, `history/public%2Ftheme/${revision}`)).status).toBe(404);
        const preview = await call(full.key, `history/public%2Ftheme/${revision}`);
        const expected = { id: preview.data.current.id, version: preview.data.current.version };
        const restored = await call(
          full.key,
          `history/public%2Ftheme/${revision}/restore`,
          "POST",
          { expected },
          "restore",
        );
        expect(restored.status).toBe(201);
        expect(restored.data.item.value).toBe("dark");
        expect(restored.data.item.version).toBe(3);
        expect(
          (
            await call(
              full.key,
              `history/public%2Ftheme/${revision}/restore`,
              "POST",
              { expected },
              "restore-stale",
            )
          ).status,
        ).toBe(409);
        expect(
          (await call(full.key, "item/public%2Ftheme", "PUT", { value: false }, "type-change"))
            .status,
        ).toBe(200);
        const sdk = new SyncStore({
          serverUrl: base,
          apiKey: full.key,
          userId: user,
          namespace: projectId,
          autoConnect: false,
        });
        try {
          expect(await sdk.getHistory("public/theme")).toHaveLength(4);
          const preview = await sdk.previewRestore("public/theme", revision);
          const expected = { id: preview.current.id, version: preview.current.version };
          const result = await sdk.restoreVersion(
            "public/theme",
            revision,
            expected,
            "sdk-restore",
          );
          expect(result.item.value).toBe("dark");
          expect(result.item.version).toBe(5);
        } finally {
          sdk.destroy();
        }
      } finally {
        sockets.forEach((socket) => socket.disconnect());
        await db.close();
      }
    }, 15000);
  },
);
