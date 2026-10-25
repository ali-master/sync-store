import "reflect-metadata";
import { expect, test } from "bun:test";
import { MongoClient } from "mongodb";
import {
  quotaConsumption,
  quotaWindows,
  quotaWindow,
} from "../../src/domains/sync-storage/services/quota-window";
import { ApiKeyQuotaService } from "../../src/domains/sync-storage/services/api-key-quota.service";

test.skipIf(!process.env.TEST_DATABASE_URL)(
  "quota rollover is atomic across workers and every UTC calendar boundary",
  async () => {
    const client = await new MongoClient(process.env.TEST_DATABASE_URL!).connect();
    const collection = client.db().collection<any>(`quota_qa_${crypto.randomUUID()}`);
    const db = { native: { collection: () => collection } } as any;
    const first = new ApiKeyQuotaService(db),
      second = new ApiKeyQuotaService(db);
    const resetters = [
      "resetMinuteQuotas",
      "resetHourQuotas",
      "resetDailyQuotas",
      "resetMonthlyQuotas",
    ] as const;
    const consume = async () => {
      const { filter, update } = quotaConsumption();
      return (await collection.updateOne({ _id: "qa", ...filter }, update)).matchedCount;
    };
    try {
      for (const [index, window] of quotaWindows.entries()) {
        await collection.replaceOne(
          { _id: "qa" },
          { _id: "qa", [window.limit]: 20 },
          { upsert: true },
        );
        // First requests roll over without waiting for cron; competing replicas share one allowance.
        const results = await Promise.all(Array.from({ length: 100 }, consume));
        expect(results.reduce((a, b) => a + b, 0)).toBe(20);
        await Promise.all([first[resetters[index]](), second[resetters[index]]()]);
        expect(await consume()).toBe(0); // Late cron must not erase this period's usage.
        await collection.updateOne(
          { _id: "qa" },
          { $set: { [`quotaWindow_${window.unit}`]: new Date(0) } },
        );
        await Promise.all([first[resetters[index]](), second[resetters[index]]()]);
        expect(await consume()).toBe(1);
        await second[resetters[index]]();
        expect((await collection.findOne({ _id: "qa" }))![window.counter]).toBe(1);
      }
      // Evaluate the actual Mongo expressions at minute/hour/day/month, leap-day and year boundaries.
      for (const [unit, before, after] of [
        ["minute", "2026-10-25T12:00:59.999Z", "2026-10-25T12:01:00Z"],
        ["hour", "2026-10-25T12:59:59.999Z", "2026-10-25T13:00:00Z"],
        ["day", "2028-02-28T23:59:59.999Z", "2028-02-29T00:00:00Z"],
        ["month", "2028-02-29T23:59:59.999Z", "2028-03-01T00:00:00Z"],
        ["month", "2026-12-31T23:59:59.999Z", "2027-01-01T00:00:00Z"],
      ]) {
        const window = quotaWindows.find((w) => w.unit === unit)!;
        const expression = quotaWindow(window);
        const at = (value: any, date: string): any =>
          value === "$$NOW"
            ? new Date(date)
            : value instanceof Date
              ? value
              : Array.isArray(value)
                ? value.map((v) => at(v, date))
                : value && typeof value === "object"
                  ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, at(v, date)]))
                  : value;
        await collection.updateOne({ _id: "qa" }, [
          { $set: { [expression.marker]: at(expression.start, before), [window.counter]: 20 } },
        ]);
        const [result] = await collection
          .aggregate([
            {
              $project: {
                before: at(expression.usage, before),
                after: at(expression.usage, after),
              },
            },
          ])
          .toArray();
        expect(result.before).toBe(20);
        expect(result.after).toBe(0);
      }
    } finally {
      await collection.drop();
      await client.close();
    }
  },
  30000,
);
