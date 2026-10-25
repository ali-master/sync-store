import "reflect-metadata";
import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { AnalyticsMiddleware } from "../../src/domains/analytics/middleware/analytics.middleware";

/** Credentials and stored user values must never enter analytics events. */
test("analytics uses authenticated record IDs and excludes payloads", () => {
  const events: unknown[] = [];
  const middleware = new AnalyticsMiddleware({
    trackEvent: async (event: unknown) => events.push(event),
  } as any);
  const req = {
    headers: { "x-api-key": "secret-key" },
    query: { token: "secret-query" },
    path: "/sync/items/private-key",
    method: "GET",
    apiKey: undefined as { id: string } | undefined,
  };
  const res = Object.assign(new EventEmitter(), { statusCode: 200 });
  middleware.use(req as any, res as any, () => {});
  req.apiKey = { id: "record-id" };
  res.emit("finish");
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ apiKeyId: "record-id", statusCode: 200 });
  expect(JSON.stringify(events)).not.toContain("secret");
  expect(JSON.stringify(events)).not.toContain("private-key");
});

/** Denied requests cannot inject arbitrary user IDs into analytics. */
test("analytics ignores unauthenticated requests", () => {
  let calls = 0;
  const middleware = new AnalyticsMiddleware({ trackEvent: async () => calls++ } as any);
  const res = new EventEmitter();
  middleware.use({ headers: { "x-user-id": "spoofed" } } as any, res as any, () => {});
  res.emit("finish");
  expect(calls).toBe(0);
});
