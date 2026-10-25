import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import { MongoClient } from "mongodb";
import { SyncStorageRepository } from "../../src/domains/sync-storage/repositories/sync-storage.repository";

describe.skipIf(!process.env.TEST_DATABASE_URL)("version history and restore", () => {
  test("retains false/null, restores deletion, rejects stale previews, and rolls back history with mutations", async () => {
    const client = await new MongoClient(process.env.TEST_DATABASE_URL!).connect();
    const native = client.db(`history_${crypto.randomUUID().replaceAll("-", "")}`);
    const repo = new SyncStorageRepository({ client, native } as any);
    await native
      .collection("sync_storage_items")
      .createIndex({ userId: 1, key: 1 }, { unique: true });
    const put = (value: unknown) =>
      repo.upsert({
        userId: "user",
        key: "theme",
        instanceId: "test",
        value,
        metadata: { marker: value },
        version: 1,
        timestamp: Date.now(),
        lastModified: new Date(),
      });
    try {
      const original = await put(false);
      await put(null);
      await repo.delete("user", "theme");
      expect(await repo.history("other", "theme")).toEqual([]);
      expect(await repo.history("user", "theme")).toHaveLength(3);
      const revision = `${original.id}:1`;
      const preview = await repo.preview("user", "theme", revision);
      expect(preview.current?.isDeleted).toBe(true);
      const result = await repo.restore(
        "user",
        "restore",
        "theme",
        revision,
        preview.current,
        "restore-1",
      );
      expect(result.item?.value).toBe(false);
      expect(result.item?.metadata).toEqual({ marker: false });
      expect(result.item?.version).toBe(4);
      await put("concurrent");
      await expect(
        repo.restore("user", "restore", "theme", revision, preview.current, "restore-2"),
      ).rejects.toThrow("changed since preview");
      expect(
        (await repo.restore("user", "restore", "theme", revision, preview.current, "restore-1"))
          .item?.version,
      ).toBe(4);
      await expect(
        repo.mutate("user", "abort", {}, async () => {
          await put("rollback");
          throw new Error("abort");
        }),
      ).rejects.toThrow("abort");
      expect(await repo.history("user", "theme")).toHaveLength(5);
      const time = new Date();
      await native
        .collection<{ _id: string; [key: string]: any }>("storage_history")
        .insertMany(
          Array.from({ length: 65 }, (_, index) => ({
            _id: `page:${index + 1}`,
            userId: "user",
            key: "page",
            version: index + 1,
            lastModified: time,
            expiresAt: new Date(Date.now() + 60000),
          })),
        );
      const first = await repo.history("user", "page");
      const second = await repo.history("user", "page", first.at(-1)!._id);
      expect([...first, ...second].map((row) => row.version)).toEqual(
        Array.from({ length: 65 }, (_, index) => 65 - index),
      );
      expect(
        (await native.collection("sync_storage_items").findOne({ userId: "user" }))!.version,
      ).toBe(5);
      await native
        .collection("storage_history")
        .updateMany({}, { $set: { expiresAt: new Date(0) } });
      expect(await repo.history("user", "theme")).toEqual([]);
      await expect(repo.preview("user", "theme", revision)).rejects.toThrow("not found");
    } finally {
      await native.dropDatabase();
      await client.close();
    }
  });
});
