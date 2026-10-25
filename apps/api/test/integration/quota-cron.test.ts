import "reflect-metadata";
import { expect, test } from "bun:test";
import { Database } from "../../src/modules/db/db.client";
import { apiKeyData } from "../../src/modules/db/api-key-data";

test.skipIf(!process.env.TEST_LIVE_QUOTA_CRON)(
  "running replicas reset an idle key at the real minute boundary",
  async () => {
    const db = new Database();
    await db.onModuleInit();
    const key = apiKeyData("Live cron QA", crypto.randomUUID());
    await db.orm.api_keys.create(key);
    const keys = db.native.collection<any>("api_keys");
    try {
      await keys.updateOne({ _id: key.id }, [
        {
          $set: {
            currentMinuteUsage: 7,
            quotaWindow_minute: { $dateTrunc: { date: "$$NOW", unit: "minute", timezone: "UTC" } },
          },
        },
      ]);
      const before = await keys.findOne({ _id: key.id });
      const deadline = Date.now() + 65000;
      let after = before;
      while (Date.now() < deadline) {
        await Bun.sleep(500);
        after = await keys.findOne({ _id: key.id });
        if (after!.quotaWindow_minute > before!.quotaWindow_minute) break;
      }
      expect(after!.quotaWindow_minute.getTime()).toBeGreaterThan(
        before!.quotaWindow_minute.getTime(),
      );
      expect(after!.currentMinuteUsage).toBe(0);
      console.log(
        "Real cron minute rollover:",
        before!.quotaWindow_minute,
        "->",
        after!.quotaWindow_minute,
      );
    } finally {
      await keys.deleteOne({ _id: key.id });
      await db.onApplicationShutdown();
    }
  },
  70000,
);
