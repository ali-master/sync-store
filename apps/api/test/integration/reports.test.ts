import "reflect-metadata";
import { expect, test } from "bun:test";
import { MongoClient } from "mongodb";
import { OperationsService } from "../../src/domains/analytics/operations.service";

test.skipIf(!process.env.TEST_REPORTS_DATABASE_URL)(
  "replica metrics aggregate once and shared snapshots do not multiply",
  async () => {
    const client = await new MongoClient(process.env.TEST_REPORTS_DATABASE_URL!).connect();
    const db = client.db("reports_test_" + crypto.randomUUID().replaceAll("-", ""));
    const operations = new OperationsService({ native: db } as any);
    try {
      await operations.onModuleInit();
      const time = new Date(Math.floor(Date.now() / 60000) * 60000 - 60000);
      await db.collection("operation_metrics").insertMany([
        { time, replica: "a", published: 95, latency0: 95 },
        { time, replica: "b", published: 5, latency4: 5 },
      ]);
      await db
        .collection("sync_storage_items")
        .insertOne({ outbox: [{ timestamp: Date.now() - 5000 }, { timestamp: Date.now() }] });
      await operations.snapshot();
      await operations.snapshot();
      const result = await operations.health({ hours: "1" });
      expect(result.series[0].published).toBe(100);
      expect(result.series[0].p95UpperMs).toBe(10);
      expect(result.snapshots.at(-1)?.pending).toBe(2);
      expect(await db.collection("operation_snapshots").countDocuments()).toBe(1);
      const filtered = await operations.health({ hours: "1", replica: "b" });
      expect(filtered.series[0].published).toBe(5);
      expect(filtered.series[0].p95UpperMs).toBe(500);
      expect(filtered.snapshots.at(-1)?.pending).toBe(2);
      expect(await db.collection("operation_metrics").indexExists("expiresAt_1")).toBe(true);
    } finally {
      await db.dropDatabase();
      await client.close();
    }
  },
);
