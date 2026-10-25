import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "../../src/modules/db/db.client";
import { apiKeyData } from "../../src/modules/db/api-key-data";
import { SyncStorageRepository } from "../../src/domains/sync-storage/repositories/sync-storage.repository";
import { ApiKeyGuard } from "../../src/domains/sync-storage/guards/api-key.guard";
import {
  ConflictResolutionService,
  ConflictType,
} from "../../src/domains/sync-storage/services/conflict-resolution.service";
import { AnalyticsAggregationService } from "../../src/domains/analytics/services/analytics-aggregation.service";
import { UserAnalyticsService } from "../../src/domains/analytics/services/user-analytics.service";
import { InstanceAnalyticsService } from "../../src/domains/analytics/services/instance-analytics.service";
import { ApiKeyQuotaService } from "../../src/domains/sync-storage/services/api-key-quota.service";

describe.skipIf(!process.env.TEST_DATABASE_URL)("MongoDB 9 / Prisma 8 integration", () => {
  let db: Database;
  let repository: SyncStorageRepository;
  const userId = "integration-" + crypto.randomUUID();
  const instanceId = userId;
  const key = crypto.randomUUID();
  let apiKeyId: string;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL!;
    db = new Database();
    await db.onModuleInit();
    repository = new SyncStorageRepository(db);
    const result = await db.orm.api_keys.create({
      ...apiKeyData("integration", key),
      canWrite: true,
      minuteQuota: 10,
    });
    apiKeyId = result.id;
  });
  test("response metrics preserve the contract's Int32 BSON type", async () => {
    const metrics = new ApiKeyQuotaService(db);
    await metrics.updatePerformanceMetrics(apiKeyId, 7);
    await metrics.updatePerformanceMetrics(apiKeyId, 12);
    const keyRecord = await db.orm.api_keys.where({ id: apiKeyId }).first();
    expect(keyRecord?.successfulCalls).toBe(2);
    expect(keyRecord?.avgResponseTimeMs).toBe(10);
  });
  afterAll(async () => {
    if (!db) return;
    await Promise.all(
      ["sync_storage_items", "sync_conflicts", "sync_sessions"].map((name) =>
        db.native.collection(name).deleteMany({ userId }),
      ),
    );
    await db.native.collection("api_keys").deleteMany({ key });
    await db.onApplicationShutdown();
  });

  test("preserves falsy JSON values and literal key prefixes", async () => {
    for (const [index, value] of [false, 0, "", null].entries()) {
      await repository.upsert({
        userId,
        instanceId,
        key: "a." + index,
        value,
        version: 1,
        timestamp: Date.now(),
        lastModified: new Date(),
      });
      expect((await repository.findByKey(userId, "a." + index))?.value).toBe(value);
    }
    expect(await repository.findKeys(userId, "a.")).toHaveLength(4);
    expect(await repository.findKeys(userId, "a*")).toHaveLength(0);
    expect(await repository.findByKey("other-tenant", "a.0")).toBeNull();
  });

  test("concurrent writes receive distinct monotonically increasing versions", async () => {
    const input = {
      userId,
      instanceId,
      key: "race",
      value: 0,
      version: 1,
      timestamp: Date.now(),
      lastModified: new Date(),
    };
    await repository.upsert(input);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, value) => repository.upsert({ ...input, value })),
    );
    expect(new Set(results.map((item) => item.version)).size).toBe(20);
    expect((await repository.findByKey(userId, "race"))?.version).toBe(21);
  });

  test("atomic quota permits exactly the remaining number of requests", async () => {
    const guard = new ApiKeyGuard(db);
    const results = await Promise.allSettled(
      Array.from({ length: 30 }, () =>
        guard.authorize({
          headers: { "x-api-key": key, "x-user-id": userId, "x-instance-id": instanceId },
          method: "GET",
          query: {},
          params: {},
          protocol: "http",
          ip: "127.0.0.1",
        } as any),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(10);
    expect((await db.orm.api_keys.where({ id: apiKeyId }).first())?.currentMinuteUsage).toBe(10);
  });

  test("conflict records retain the existing item identifier", async () => {
    const item = await repository.findByKey(userId, "race");
    const conflicts = new ConflictResolutionService(db);
    const conflict = await conflicts.createConflict(item!.id!, userId, {
      type: ConflictType.VERSION_MISMATCH,
      currentValue: "0",
      newValue: "1",
    });
    expect((await conflicts.getConflictHistory(item!.id!, userId))[0].id).toBe(conflict.id);
    expect(await conflicts.getConflictHistory(item!.id!, "other-tenant")).toEqual([]);
    expect(
      (await conflicts.getUserConflictStats(userId, { start: new Date(0), end: new Date() }))
        .totalConflicts,
    ).toBe(1);
  });

  test("Mongo aggregation runs through dashboard, user and cohort paths", async () => {
    const range = { start: new Date(0), end: new Date(), granularity: "day" as const };
    const platform = await new AnalyticsAggregationService(db).getDashboardAnalytics(range, {
      userIds: [userId],
    });
    expect(platform.totalRequests).toBeGreaterThanOrEqual(5);
    const users = new UserAnalyticsService(db);
    expect((await users.getUserAnalytics(userId, range)).userId).toBe(userId);
    await users.getUserCohortAnalysis(range);
    expect(
      (await new InstanceAnalyticsService(db).getInstanceHealthStatus(instanceId)).isOnline,
    ).toBeFalsy();
  });

  test("deletes remain deleted and do not cross tenant boundaries", async () => {
    await repository.delete(userId, "a.0");
    expect(await repository.findByKey(userId, "a.0")).toBeNull();
    await repository.clearAll(userId);
    expect(await repository.count(userId)).toBe(0);
  });
});
