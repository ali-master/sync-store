import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import { MongoClient } from "mongodb";
import { SyncStorageRepository } from "../../src/domains/sync-storage/repositories/sync-storage.repository";

describe.skipIf(!process.env.TEST_DATABASE_URL)("durable mutation receipts", () => {
  test("concurrent retries, payload conflict, rollback and delayed clear preserve data", async () => {
    const client = await new MongoClient(process.env.TEST_DATABASE_URL!).connect();
    const native = client.db(`idempotency_${crypto.randomUUID().replaceAll("-", "")}`);
    const repo = new SyncStorageRepository({ client, native } as any);
    const items = native.collection("sync_storage_items");
    await items.createIndex({ userId: 1, key: 1 }, { unique: true });
    const put = (id: string, value: unknown) =>
      repo.mutate("user", id, { type: "set", value }, () =>
        repo.upsert({
          userId: "user",
          instanceId: "test",
          key: "key",
          value,
          version: 1,
          timestamp: Date.now(),
          lastModified: new Date(),
        }),
      );
    try {
      const results = await Promise.all(Array.from({ length: 12 }, () => put("same", false)));
      expect(results.every((r) => r.version === 1)).toBe(true);
      expect((await items.findOne({ key: "key" }))!.outbox).toHaveLength(1);
      await expect(put("same", true)).rejects.toThrow("another operation");
      await expect(
        repo.mutate("user", "crash", {}, async () => {
          await repo.delete("user", "key");
          throw new Error("crash before commit");
        }),
      ).rejects.toThrow("crash before commit");
      expect((await items.findOne({ key: "key" }))!.isDeleted).toBe(false);
      expect(
        await native
          .collection("mutation_receipts")
          .countDocuments({ _id: JSON.stringify(["user", "crash"]) as any }),
      ).toBe(0);
      const clear = () =>
        repo.mutate("user", "clear", { type: "clear" }, () => repo.clearAll("user"));
      await clear();
      await put("new", "newer");
      await clear();
      expect((await items.findOne({ key: "key" }))!.value).toBe('"newer"');
      expect((await put("same", false)).version).toBe(1);
      expect((await items.findOne({ key: "key" }))!.version).toBe(3);
    } finally {
      await native.dropDatabase();
      await client.close();
    }
  });
});
