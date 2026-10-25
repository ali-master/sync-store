import "reflect-metadata";
import { expect, test, spyOn } from "bun:test";
import { Database } from "../../src/modules/db/db.client";
import { SyncStorageRepository } from "../../src/domains/sync-storage/repositories/sync-storage.repository";
import { VersioningService } from "../../src/domains/sync-storage/services/versioning.service";
import { inMutation } from "../../src/domains/sync-storage/repositories/mutation-context";

test.skipIf(!process.env.TEST_DATABASE_URL)(
  "commit atomicity, concurrent heads, projection retries and covered key index",
  async () => {
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const db = new Database();
    process.env.DATABASE_URL = previous;
    const repo = new SyncStorageRepository(db),
      versions = new VersioningService(db, repo);
    const user = "version-store-" + crypto.randomUUID();
    const put = (key: string, value: unknown) =>
      repo.upsert({
        userId: user,
        key,
        value,
        version: 1,
        timestamp: Date.now(),
        lastModified: new Date(),
        instanceId: "qa",
      });
    try {
      await db.onModuleInit();
      await versions.onModuleInit();
      await Promise.all([put("one", 1), put("two", 2)]);
      expect(await versions.commits(user)).toHaveLength(2);
      const head = (await versions.branches(user))[0].head;
      await expect(
        inMutation(db, async () => {
          await put("one", "aborted");
          throw new Error("crash before transaction commit");
        }),
      ).rejects.toThrow("crash before transaction commit");
      expect((await versions.branches(user))[0].head).toBe(head);
      expect((await repo.findByKey(user, "one"))?.value).toBe(1);
      const concurrent = await Promise.allSettled([
        versions.checkpoint(user, { message: "A", expectedHead: head }),
        versions.checkpoint(user, { message: "B", expectedHead: head }),
      ]);
      expect(concurrent.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(concurrent.filter((r) => r.status === "rejected")).toHaveLength(1);
      await put("__proto__", false);
      const current = (await versions.branches(user))[0].head!;
      const tree = (await versions.commit(user, current)).tree;
      expect(Object.hasOwn(tree, "__proto__")).toBe(true);
      await versions.fork(user, { name: "prototype", commitId: current });
      expect((await repo.findByKey("branch:prototype:" + user, "__proto__"))?.value).toBe(false);
      await versions.project();
      // Simulate a crash after time-series insertion but before its acknowledgement.
      await db.orm.version_commits.where({ id: current }).update({ projected: false });
      await versions.project();
      const timeline = await versions.timeline(user);
      expect(timeline.filter((row) => row._id === current)).toHaveLength(1);
      expect(
        await db.native.collection("commit_timeline").countDocuments({ commitId: current }),
      ).toBeGreaterThanOrEqual(2);
      const commits = await versions.commits(user);
      const next = await versions.commits(user, commits[0].id);
      expect(next.map((r) => r.id)).toEqual(commits.slice(1).map((r) => r.id));
      const clock = spyOn(Date, "now").mockReturnValue(0);
      try {
        const last = await versions.checkpoint(user, {
          message: "Clock skew",
          expectedHead: current,
        });
        expect((await versions.commits(user))[0].id).toBe(last.id);
        expect(+last.createdAt).toBeGreaterThan(+commits[0].createdAt);
      } finally {
        clock.mockRestore();
      }
      const sample = await db.native
        .collection("sync_storage_items")
        .findOne({ userId: user }, { promoteLongs: false });
      const owner = user + "-index";
      await db.native.collection("sync_storage_items").insertMany(
        Array.from({ length: 1000 }, (_, i) => ({
          ...sample!,
          _id: crypto.randomUUID() as any,
          userId: owner,
          key: String(i).padStart(5, "0"),
          isDeleted: i >= 10,
          outbox: [],
        })),
      );
      const query = () =>
        db.native
          .collection("sync_storage_items")
          .find({ userId: owner, isDeleted: false }, { projection: { _id: 0, key: 1 } })
          .sort({ key: 1 });
      const before = await query().hint({ userId: 1, key: 1 }).explain("executionStats");
      const after = await query()
        .hint({ userId: 1, isDeleted: 1, key: 1 })
        .explain("executionStats");
      expect(after.executionStats.nReturned).toBe(10);
      expect(after.executionStats.totalDocsExamined).toBe(0);
      expect(after.executionStats.totalKeysExamined).toBeLessThan(
        before.executionStats.totalKeysExamined,
      );
      console.log(
        "Key query explain",
        JSON.stringify(
          { before: before.executionStats, after: after.executionStats },
          (key, value) => (key === "executionStages" ? undefined : value),
        ),
      );
    } finally {
      await db.onApplicationShutdown();
    }
  },
  30000,
);
