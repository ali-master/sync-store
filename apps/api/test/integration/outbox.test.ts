import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import { MongoClient } from "mongodb";
import { SyncStorageRepository } from "../../src/domains/sync-storage/repositories/sync-storage.repository";
import { OutboxService } from "../../src/domains/sync-storage/services/outbox.service";

describe.skipIf(!process.env.TEST_DATABASE_URL)("atomic embedded outbox", () => {
  test("mutations retain every version, failed publication retries the same ID, cleanup preserves pending removals", async () => {
    const client = new MongoClient(process.env.TEST_DATABASE_URL!);
    await client.connect();
    const native = client.db();
    const userId = `outbox-test-${crypto.randomUUID()}`;
    const schema = await native.listCollections({ name: "sync_storage_items" }).next();
    if (!schema?.options.validator)
      throw new Error("Apply the storage migrations before this test");
    const collection = await native.createCollection(`outbox_fixture_${crypto.randomUUID()}`, {
      validator: schema.options.validator,
    });
    await collection.createIndex({ userId: 1, key: 1 }, { unique: true });
    const scoped = new Proxy(collection, {
      get(target, property) {
        if (property === "deleteMany")
          return (filter: any) => target.deleteMany({ ...filter, userId });
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const history = await native.createCollection(`history_fixture_${crypto.randomUUID()}`);
    const changes = await native.createCollection(`changes_fixture_${crypto.randomUUID()}`);
    const repository = new SyncStorageRepository({
      client,
      native: {
        collection: (name: string) =>
          name === "storage_history"
            ? history
            : name === "storage_change_events"
              ? changes
              : name.startsWith("version_")
                ? native.collection(name)
                : scoped,
      },
    } as any);
    // Worker queries are scoped to this fixture so no unrelated installation work is claimed.
    const workerDb = {
      native: {
        collection: () => ({
          findOneAndUpdate: (filter: any, ...args: any[]) =>
            (collection.findOneAndUpdate as any)({ ...filter, userId }, ...args),
          updateOne: (...args: any[]) => (collection.updateOne as any)(...args),
        }),
      },
    } as any;
    const worker = new OutboxService(
      workerDb,
      {} as any,
      { record: async () => {}, published: async () => {} } as any,
    );
    const write = (key: string, value: unknown) =>
      repository.upsert({
        userId,
        key,
        value,
        instanceId: "test",
        version: 1,
        timestamp: Date.now(),
        lastModified: new Date(),
      });
    try {
      await write("$literal", "$value");
      await write("$literal", false);
      await expect(write("$literal", "x".repeat(17 * 1024 * 1024))).rejects.toThrow();
      const unchanged = await collection.findOne({ userId, key: "$literal" });
      expect(unchanged!.version).toBe(2);
      expect(unchanged!.value).toBe("false");
      expect(unchanged!.outbox).toHaveLength(2);
      await repository.delete(userId, "$literal", "remover");
      let item = await collection.findOne({ userId, key: "$literal" });
      expect(item!.outbox.map((e: any) => [e.type, e.version])).toEqual([
        ["sync", 1],
        ["sync", 2],
        ["remove", 3],
      ]);
      expect(item!.outbox[0].key).toBe("$literal");
      expect(JSON.parse(item!.outbox[0].value)).toBe("$value");
      const original = item!.outbox.map((e: any) => e.eventId);
      await repository.cleanup(0);
      expect(await collection.countDocuments({ userId })).toBe(1);
      (worker as any).publish = async () => {
        throw new Error("simulated lost publish acknowledgement");
      };
      await worker.drain();
      item = await collection.findOne({ userId });
      expect(item!.outbox.map((e: any) => e.eventId)).toEqual(original);
      expect(item!.leaseToken).toBeDefined();
      await collection.updateOne({ userId }, { $set: { leaseUntil: new Date(0) } });
      const delivered: string[] = [];
      (worker as any).publish = async (event: any) => {
        delivered.push(event.eventId);
      };
      await worker.drain();
      expect(delivered).toEqual(original);
      expect((await collection.findOne({ userId }))!.outbox).toEqual([]);
      await write("a", 0);
      await write("b", null);
      await repository.clearAll(userId, "clearer");
      const cleared = await collection.find({ userId, key: { $in: ["a", "b"] } }).toArray();
      expect(
        cleared.every(
          (d) =>
            d.isDeleted && d.outbox[1].type === "remove" && d.outbox[1].instanceId === "clearer",
        ),
      ).toBe(true);
    } finally {
      worker.onApplicationShutdown();
      await collection.drop();
      await history.drop();
      await changes.drop();
      await client.close();
    }
  });
});
