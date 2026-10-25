import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import { MongoClient } from "mongodb";
import { io, type Socket } from "socket.io-client";
import { RemoteStorage } from "../../../../packages/sync-client/src/remote-storage";

describe.skipIf(!process.env.TEST_API_URL || !process.env.TEST_DATABASE_URL)(
  "tenant and branch isolation",
  () => {
    test("isolates credentials, reports, sockets and immutable trees across tenants", async () => {
      const db = await new MongoClient(process.env.TEST_DATABASE_URL!).connect();
      const base = process.env.TEST_API_URL!;
      const user = "tenant-qa-" + crypto.randomUUID();
      const sockets: Socket[] = [];
      const sdks: RemoteStorage[] = [];
      const call = async (
        key: string,
        path: string,
        method = "GET",
        body?: unknown,
        branch = "main",
        requestId?: string,
      ) => {
        const origin = method === "PUT" ? process.env.TEST_WRITE_API_URL || base : base;
        const response = await fetch(`${origin}/api/v1/${path}`, {
          method,
          headers: {
            Authorization: "Bearer " + key,
            "x-api-key": key,
            "x-user-id": user,
            "x-instance-id": "qa",
            "x-branch": branch,
            ...(body === undefined ? {} : { "content-type": "application/json" }),
            ...(requestId ? { "Idempotency-Key": requestId } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const json = await response.json();
        return { status: response.status, data: json.payload, error: json.message };
      };
      try {
        let root = (
          await db
            .db()
            .collection("api_keys")
            .findOne({ _id: "sync-store-bootstrap-admin" as any })
        )?.key;
        if (!root) {
          const setup = await db
            .db()
            .collection("installation_setup")
            .findOne({ _id: "initial" as any });
          root = (await call("", "setup", "POST", { code: setup?.code, name: "Versioning QA" }))
            .data.key;
        }
        const tenants = [];
        for (const name of ["A", "B"]) {
          const result = await call(root, "admin/tenants", "POST", { name: user + name });
          expect(result.status, JSON.stringify(result)).toBe(201);
          tenants.push(result.data);
        }
        const [a, b] = tenants;
        const keys = [];
        for (const tenant of tenants) {
          const result = await call(tenant.key, "admin/keys", "POST", {
            name: "Application",
            canRead: true,
            canWrite: true,
          });
          expect(result.status, JSON.stringify(result)).toBe(201);
          keys.push(result.data);
        }
        const [ka, kb] = keys;
        expect((await call(a.key, "admin/tenants", "POST", { name: "escape" })).status).toBe(403);
        expect((await call(a.key, "admin/resources/tenants")).status).toBe(403);
        expect((await call(a.key, "admin/keys/" + kb.id, "PATCH", { name: "stolen" })).status).toBe(
          404,
        );
        expect((await call(a.key, "admin/overview")).data.tenantId).toBe(a._id);
        expect(
          (await call(a.key, "admin/resources/keys")).data.items.some((r: any) => r._id === kb.id),
        ).toBe(false);
        const eventsA: any[] = [],
          eventsB: any[] = [];
        for (const [key, events] of [
          [ka.key, eventsA],
          [kb.key, eventsB],
        ] as const) {
          const socket = io(base + "/sync", {
            transports: ["websocket"],
            forceNew: true,
            auth: { apiKey: key, userId: user, instanceId: crypto.randomUUID() },
          });
          sockets.push(socket);
          socket.on("sync:update", (e) => events.push(e));
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("socket timeout")), 5000);
            socket.once("connect", () =>
              socket.emit("sync:subscribe", { keys: ["*"] }, () => {
                clearTimeout(timeout);
                resolve();
              }),
            );
            socket.once("connect_error", reject);
          });
        }
        expect(
          (await call(ka.key, "item/theme", "PUT", { value: "a" }, "main", "same-id")).status,
        ).toBe(200);
        expect(
          (await call(kb.key, "item/theme", "PUT", { value: "b" }, "main", "same-id")).status,
        ).toBe(200);
        const until = Date.now() + 5000;
        while ((!eventsA.length || !eventsB.length) && Date.now() < until) await Bun.sleep(50);
        expect(eventsA.some((e) => e.value === "a")).toBe(true);
        expect(eventsA.some((e) => e.value === "b")).toBe(false);
        expect(eventsB.some((e) => e.value === "b")).toBe(true);
        expect(eventsB.some((e) => e.value === "a")).toBe(false);
        const sdk = new RemoteStorage({
          serverUrl: base,
          apiKey: ka.key,
          userId: user,
          autoConnect: false,
          namespace: user + "-A",
        });
        sdks.push(sdk);
        const commits = await sdk.getCommits();
        expect(commits).toHaveLength(1);
        const first = commits[0].id;
        expect((await call(kb.key, "versioning/commits/" + first)).status).toBe(404);
        await sdk.createBranch("feature/test", first);
        expect(
          (await call(ka.key, "item/theme", "PUT", { value: "branch" }, "feature/test", "same-id"))
            .status,
        ).toBe(200);
        expect((await call(ka.key, "item/theme")).data.value).toBe("a");
        const fork = new RemoteStorage({
          serverUrl: base,
          apiKey: ka.key,
          userId: user,
          branch: "feature/test",
          namespace: user + "-A",
          autoConnect: false,
        });
        sdks.push(fork);
        expect((await fork.getCommits())[0].parent).toBe(first);
        const checkpoint = await fork.commit(
          "Checkpoint",
          (await fork.getBranches()).find((r: any) => r.name === "feature/test").head,
          "checkpoint",
        );
        expect((await fork.commit("Checkpoint", checkpoint.parent, "checkpoint")).id).toBe(
          checkpoint.id,
        );
        expect(
          (
            await call(
              ka.key,
              "versioning/commits",
              "POST",
              { message: "stale", expectedHead: first },
              "feature/test",
            )
          ).status,
        ).toBe(409);
        expect(
          (await call(ka.key, "item/extra", "PUT", { value: false }, "feature/test")).status,
        ).toBe(200);
        const current = (await fork.getBranches()).find((r: any) => r.name === "feature/test").head;
        const restored = await fork.restoreCommit(
          first,
          "Restore baseline",
          current,
          "restore-tree",
        );
        expect(restored.parent).toBe(current);
        expect(
          (await call(ka.key, "item/theme", "GET", undefined, "feature/test")).data.value,
        ).toBe("a");
        expect(
          (await call(ka.key, "item/extra", "GET", undefined, "feature/test")).data,
        ).toBeNull();
        expect((await call(kb.key, "item/theme")).data.value).toBe("b");
        expect(
          (
            await call(a.key, "admin/storage", "POST", {
              userId: `tenant:${b._id}:${user}`,
              key: "escape",
              value: 1,
            })
          ).status,
        ).toBe(403);
        const saved = await call(b.key, "admin/reports/saved", "POST", {
          name: "B only",
          kind: "changes",
          query: { hours: "24" },
        });
        expect(saved.status, JSON.stringify(saved)).toBe(201);
        expect(JSON.stringify((await call(a.key, "admin/reports/saved")).data)).not.toContain(
          "B only",
        );
        const usage = await call(a.key, "admin/reports/usage?apiKeyId=" + kb.id);
        expect(usage.data.quotas).toHaveLength(0);
        const changes = await call(a.key, "admin/reports/changes");
        expect(JSON.stringify(changes.data)).not.toContain(b._id);
        const seriesDeadline = Date.now() + 6000;
        while (!(await fork.getCommitTimeline()).length && Date.now() < seriesDeadline)
          await Bun.sleep(100);
        expect((await fork.getCommitTimeline()).length).toBeGreaterThan(0);
        expect((await db.db().listCollections({ name: "commit_timeline" }).next())?.type).toBe(
          "timeseries",
        );
        expect(
          (await call(root, "admin/tenants/" + a._id, "PATCH", { isActive: false })).status,
        ).toBe(200);
        expect((await call(ka.key, "keys")).status).toBe(403);
        expect((await call(a.key, "admin/overview")).status).toBe(403);
        expect((await call(kb.key, "keys")).status).toBe(200);
        expect(
          (await call(root, "admin/tenants/" + a._id, "PATCH", { isActive: true })).status,
        ).toBe(200);
      } finally {
        sdks.forEach((s) => s.destroy());
        sockets.forEach((s) => s.disconnect());
        await db.close();
      }
    }, 30000);
  },
);
