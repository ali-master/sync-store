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
      await db.collection("operation_metrics").insertMany([
        {
          time,
          replica: "a",
          project: "one",
          apiKeyId: "key-one",
          admitted: 10,
          reads: 8,
          writes: 2,
          httpRequests: 5,
          httpErrors: 1,
          quotaRejections: 1,
        },
        { time, replica: "b", project: "two", apiKeyId: "key-two", admitted: 20 },
      ]);
      await db.collection<{ _id: string; [key: string]: any }>("api_keys").insertOne({
        _id: "key-one",
        key: "secret-must-not-escape",
        name: "One",
        metadata: JSON.stringify({ access: { projectId: "one" } }),
        minuteQuota: 100,
        currentMinuteUsage: 99,
        quotaWindow_minute: new Date(0),
      });
      const usage = await operations.usage({ project: "one", hours: "1" });
      expect(usage.series[0].admitted).toBe(10);
      expect(usage.topKeys).toHaveLength(1);
      expect(usage.quotas.find((row) => row.window === "minute")?.used).toBe(0);
      expect(JSON.stringify(usage)).not.toContain("secret-must-not-escape");
      const mismatch = await operations.usage({ project: "two", apiKeyId: "key-one" });
      expect(mismatch.quotas).toHaveLength(0);
    } finally {
      await db.dropDatabase();
      await client.close();
    }
  },
);
