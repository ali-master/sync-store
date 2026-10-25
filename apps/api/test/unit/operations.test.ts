import "reflect-metadata";
import { expect, test } from "bun:test";
import {
  OperationsService,
  percentile,
  reportRange,
} from "../../src/domains/analytics/operations.service";

test("report windows reject unbounded input and compare equal durations", () => {
  const now = Date.now();
  const range = reportRange({ hours: "168" }, now);
  expect(+range.end - +range.start).toBe(168 * 3600000);
  expect(range.step).toBe(3600000);
  expect(() => reportRange({ hours: "100000" })).toThrow();
  expect(() => reportRange({ end: "invalid" })).toThrow();
});

test("histograms merge counts and distinguish overflow from no latency", () => {
  expect(percentile([95, 0, 0, 0, 5], 0.95)).toBe(10);
  expect(percentile([1, 0, 0, 0, 99], 0.95)).toBe(500);
  expect(percentile([0, 0, 0, 0, 0, 0, 0, 0, 0, 1], 0.95)).toBeNull();
  expect(percentile([], 0.95)).toBeNull();
});

test("metric buckets contain no payloads and failures do not affect mutation delivery", async () => {
  let update: any;
  const service = new OperationsService({
    native: {
      collection: () => ({
        updateOne: async (_: any, value: any) => {
          update = value;
        },
      }),
    },
  } as any);
  await service.published(Date.now() - 200);
  expect(update.$inc.published).toBe(1);
  expect(update.$inc.latency3).toBe(1);
  expect(update.$setOnInsert.expiresAt.getTime() - update.$setOnInsert.time.getTime()).toBe(
    90 * 86400000,
  );
  const failing = new OperationsService({
    native: {
      collection: () => ({
        updateOne: async () => {
          throw new Error("offline");
        },
      }),
    },
  } as any);
  await expect(failing.record({ connections: 1 })).resolves.toBeUndefined();
});
