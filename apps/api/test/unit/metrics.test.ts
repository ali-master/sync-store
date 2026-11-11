import "reflect-metadata";
import { afterAll, describe, expect, test } from "bun:test";
import { ForbiddenException, VersioningType } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import Fastify from "fastify";
import { lastValueFrom, of } from "rxjs";
import { MetricsService, metrics, transport } from "../../src/domains/metrics/metrics.service";
import { MetricsController, readSharedState } from "../../src/domains/metrics/metrics.controller";
import { MetricsInterceptor } from "../../src/domains/metrics/metrics.module";
import { ApiKeyGuard } from "../../src/domains/sync-storage/guards/api-key.guard";
import { OperationsService } from "../../src/domains/analytics/operations.service";
import { runMutation } from "../../src/domains/sync-storage/repositories/mutation-context";
import { SyncStorageRepository } from "../../src/domains/sync-storage/repositories/sync-storage.repository";
import { ConflictResolutionService } from "../../src/domains/sync-storage/services/conflict-resolution.service";
import { VersioningService } from "../../src/domains/sync-storage/services/versioning.service";
import { issueClientSession } from "../../src/domains/sync-storage/services/client-session";
import { SyncStorageGateway } from "../../src/domains/sync-storage/gateways/sync-storage.gateway";
import { SsoService } from "../../src/domains/admin/sso.service";
import { ResponseSerializerInterceptor } from "../../src/interceptors/response-serializer.interceptor";
import { Database } from "../../src/modules/db";

// Values that must never appear as label values.
const user = "user-secret-42";
const storageKey = "secret-key-xyz";

/** The current value of one series of the shared registry; 0 when it does not exist yet. */
async function value(name: string, labels: Record<string, string> = {}) {
  const metric = metrics.registry.getSingleMetric("sync_store_" + name);
  if (!metric) throw new Error("No metric " + name);
  const series = (await metric.get()).values.find(
    (sample: any) =>
      !sample.metricName?.match(/_(bucket|sum)$/) &&
      Object.entries(labels).every(([k, v]) => String(sample.labels[k]) === v),
  );
  return series?.value ?? 0;
}

/** Run `work` and return how much the series moved. */
async function delta(name: string, labels: Record<string, string>, work: () => Promise<unknown>) {
  const before = await value(name, labels);
  await work();
  return (await value(name, labels)) - before;
}

const keys: Record<string, any> = {
  admin: {
    id: "admin-id",
    key: "admin-secret",
    isActive: true,
    canRead: true,
    canWrite: true,
    scopes: '["admin"]',
  },
  plain: {
    id: "plain-id",
    key: "plain-secret",
    isActive: true,
    canRead: true,
    canWrite: true,
    scopes: '["read","write"]',
  },
};

/** A database double for the guard, the operations service and the scrape-time sources. */
function database(options: { failing?: string; quota?: boolean; tenant?: boolean } = {}) {
  const writes: string[] = [];
  const time = new Date("2026-11-11T10:00:00Z");
  const rows: Record<string, any[]> = {
    operation_snapshots: [
      { time, tenantId: "*", pending: 5, oldestAgeMs: 4000 },
      { time, tenantId: "acme", pending: 5, oldestAgeMs: 4000 },
    ],
    operation_growth: [
      {
        time,
        tenantId: "acme",
        project: "web",
        items: 3,
        valueBytes: 120,
        historyBytes: 900,
        historyVersions: 6,
      },
    ],
  };
  const find = (filter: any) =>
    Object.values(keys).find((key) => key.key === filter.key || key.id === filter.id) ?? null;
  const db = {
    orm: {
      api_keys: { where: (filter: any) => ({ first: async () => find(filter) }) },
      tenants: { where: () => ({ first: async () => (options.tenant === false ? null : {}) }) },
    },
    native: {
      command: async () => {
        if (options.failing === "ping") throw new Error("down");
        return { ok: 1 };
      },
      collection: (name: string) => ({
        estimatedDocumentCount: async () => {
          if (options.failing === name) throw new Error("count failed");
          return 7;
        },
        findOne: async () => (rows[name]?.length ? { time } : null),
        find: () => ({ limit: () => ({ toArray: async () => rows[name] ?? [] }) }),
        updateOne: async () => {
          writes.push(name);
          return { matchedCount: options.quota === false ? 0 : 1, upsertedCount: 1 };
        },
      }),
    },
  };
  return { db: db as any, writes };
}

const request = (headers: Record<string, string>, method = "GET") =>
  ({
    headers: { "x-user-id": user, "x-instance-id": "instance", ...headers },
    method,
    query: {},
    params: { key: storageKey },
    body: {},
    protocol: "http",
    ip: "127.0.0.1",
  }) as any;

describe("exposition", () => {
  test("uses the Prometheus text format with HELP and TYPE for every family", async () => {
    const fresh = new MetricsService();
    expect(fresh.registry.contentType).toBe("text/plain; version=0.0.4; charset=utf-8");
    const text = await fresh.registry.metrics();
    const typed = new Map<string, string>();
    const helped = new Set<string>();
    for (const line of text.split("\n")) {
      if (!line) continue;
      const comment = line.match(/^# (HELP|TYPE) ([a-zA-Z_:][a-zA-Z0-9_:]*) (.+)$/);
      if (comment) {
        if (comment[1] === "TYPE") typed.set(comment[2], comment[3]);
        else helped.add(comment[2]);
        continue;
      }
      // name{label="value",...} value; label values here contain no quotes or commas.
      const space = line.lastIndexOf(" ");
      const series = line.slice(0, space),
        number = line.slice(space + 1);
      const brace = series.indexOf("{");
      const name = brace < 0 ? series : series.slice(0, brace);
      expect(name, line).toMatch(/^[a-z_:][\w:]*$/i);
      if (brace >= 0) {
        expect(series.endsWith("}"), line).toBe(true);
        for (const pair of series.slice(brace + 1, -1).split(","))
          expect(pair, line).toMatch(/^\w+="[^"]*"$/);
      }
      expect(Number.isFinite(Number(number)) || /^([+-]inf|nan)$/i.test(number), line).toBe(true);
      const family = [...typed.keys()].find(
        (family) => name === family || name.replace(/_(bucket|sum|count)$/, "") === family,
      );
      expect(family, name).toBeDefined();
    }
    for (const [name, type] of typed) {
      expect(name.startsWith("sync_store_")).toBe(true);
      expect(helped.has(name)).toBe(true);
      if (type === "counter") expect(name.endsWith("_total")).toBe(true);
    }
    expect(typed.get("sync_store_build_info")).toBe("gauge");
    expect(typed.get("sync_store_process_start_time_seconds")).toBe("gauge");
    expect(typed.get("sync_store_http_request_duration_seconds")).toBe("histogram");
    expect(text).toContain('version="1.0.0"');
    if (process.versions.bun) {
      expect(text).toContain('runtime="bun ' + process.versions.bun + '"');
      // Collectors that report nothing or zeros under Bun are not exposed.
      expect(typed.has("sync_store_nodejs_gc_duration_seconds")).toBe(false);
      expect(typed.has("sync_store_nodejs_active_handles_total")).toBe(false);
      expect(typed.has("sync_store_nodejs_heap_space_size_used_bytes")).toBe(false);
      expect(typed.has("sync_store_nodejs_eventloop_lag_p99_seconds")).toBe(true);
    }
  });
});

describe("hooks", () => {
  test("HTTP requests are counted by route template, never by raw URL", async () => {
    const app = Fastify();
    metrics.instrument(app);
    app.get("/api/v1/item/:key", async () => ({ ok: true }));
    await app.ready();
    const labels = { method: "GET", route: "/api/v1/item/:key", status_code: "200" };
    expect(
      await delta("http_requests_total", labels, () =>
        app.inject({ url: "/api/v1/item/" + storageKey }),
      ),
    ).toBe(1);
    expect(
      await delta(
        "http_requests_total",
        { method: "GET", route: "unmatched", status_code: "404" },
        () => app.inject({ url: "/nowhere/" + storageKey }),
      ),
    ).toBe(1);
    expect(await value("http_requests_in_flight")).toBe(0);
    await app.close();
  });

  test("API-key decisions are counted by transport and reason", async () => {
    const cases: [string, Record<string, any> | null, any, string?][] = [
      ["allowed", keys.plain, request({ "x-api-key": "plain-secret" })],
      ["missing", keys.plain, request({})],
      ["invalid", null, request({ "x-api-key": "nope" })],
      ["expired", { ...keys.plain, expiresAt: new Date(0) }, request({ "x-api-key": "x" })],
      ["scope", keys.plain, request({ "x-api-key": "x" }), "admin"],
      ["permission", { ...keys.plain, canWrite: false }, request({ "x-api-key": "x" }, "PUT")],
      ["restriction", { ...keys.plain, requireHttps: true }, request({ "x-api-key": "x" })],
      [
        "restriction",
        { ...keys.plain, blockedKeyPatterns: JSON.stringify([storageKey]) },
        request({ "x-api-key": "x" }),
      ],
    ];
    for (const [result, record, req, scope] of cases) {
      const guard = new ApiKeyGuard({
        orm: { api_keys: { where: () => ({ first: async () => record }) } },
        native: { collection: () => ({ updateOne: async () => ({ matchedCount: 1 }) }) },
      } as any);
      const moved = await delta("api_key_authorizations_total", { transport: "http", result }, () =>
        guard.authorize(req, scope).catch(() => undefined),
      );
      expect(moved, result).toBe(1);
    }
    const identity = request({ "x-api-key": "plain-secret" });
    delete identity.headers["x-user-id"];
    const { db } = database();
    expect(
      await delta("api_key_authorizations_total", { transport: "http", result: "identity" }, () =>
        new ApiKeyGuard(db).authorize(identity).catch(() => undefined),
      ),
    ).toBe(1);
    expect(
      await delta("api_key_authorizations_total", { transport: "http", result: "quota" }, () =>
        new ApiKeyGuard(database({ quota: false }).db)
          .authorize(request({ "x-api-key": "plain-secret" }))
          .catch(() => undefined),
      ),
    ).toBe(1);
    const tenant = { ...keys.plain, tenantId: "acme" };
    expect(
      await delta(
        "api_key_authorizations_total",
        { transport: "http", result: "inactive_tenant" },
        () =>
          new ApiKeyGuard({
            orm: {
              api_keys: { where: () => ({ first: async () => tenant }) },
              tenants: { where: () => ({ first: async () => null }) },
            },
          } as any)
            .authorize(request({ "x-api-key": "x" }))
            .catch(() => undefined),
      ),
    ).toBe(1);
    const socket = {
      data: {},
      handshake: {
        auth: { apiKey: "plain-secret", userId: user, instanceId: "i" },
        query: {},
        headers: {},
        address: "127.0.0.1",
        secure: false,
      },
    } as any;
    expect(
      await delta("api_key_authorizations_total", { transport: "socket", result: "allowed" }, () =>
        new ApiKeyGuard(db).authorizeSocket(socket),
      ),
    ).toBe(1);
  });

  test("the operational counters are mirrored by tenant and project", async () => {
    const operations = new OperationsService(database().db);
    const dims = { tenantId: "acme", project: "web", apiKeyId: "plain-id" };
    expect(
      await delta(
        "quota_admissions_total",
        { tenant: "acme", project: "web", operation: "write" },
        () => operations.record({ admitted: 1, writes: 1 }, dims),
      ),
    ).toBe(1);
    expect(
      await delta("quota_rejections_total", { tenant: "acme", project: "web" }, () =>
        operations.record({ quotaRejections: 1 }, dims),
      ),
    ).toBe(1);
    expect(
      await delta(
        "tenant_http_requests_total",
        { tenant: "acme", project: "web", outcome: "rate_limited" },
        () => operations.record({ httpRequests: 1, httpErrors: 1, http429: 1 }, dims),
      ),
    ).toBe(1);
    expect(
      await delta("sockets_connected", { tenant: "acme" }, () =>
        operations.record({ connections: 1 }, { tenantId: "acme" }),
      ),
    ).toBe(1);
    expect(
      await delta("sockets_connected", { tenant: "acme" }, () =>
        operations.record({ disconnections: 1 }, { tenantId: "acme" }),
      ),
    ).toBe(-1);
    expect(
      await delta("outbox_published_total", { tenant: "acme" }, () =>
        operations.published(Date.now() - 20, "acme"),
      ),
    ).toBe(1);
    expect(
      await delta("outbox_publish_failures_total", { tenant: "acme" }, () =>
        operations.record({ publishFailures: 1 }, { tenantId: "acme" }),
      ),
    ).toBe(1);
  });

  test("mutations are counted by operation, transport and replay", async () => {
    const receipts = new Map<string, any>();
    const session = { withTransaction: async (work: any) => work(), endSession: async () => {} };
    const db = {
      client: { startSession: () => session },
      native: {
        collection: () => ({
          findOne: async ({ _id }: any) => receipts.get(_id) ?? null,
          insertOne: async (doc: any) => void receipts.set(doc._id, doc),
          updateOne: async ({ _id }: any, { $set }: any) =>
            void Object.assign(receipts.get(_id), $set),
        }),
      },
    } as any;
    const set = () =>
      transport.run("socket", () =>
        runMutation(db, user, "request-1", { type: "set", key: storageKey }, async () => "saved"),
      );
    const ok = { operation: "set", transport: "socket", outcome: "ok" };
    expect(await delta("storage_operations_total", ok, set)).toBe(1);
    expect(await delta("idempotent_requests_total", { result: "replay" }, set)).toBe(1);
    expect(
      await delta("idempotent_requests_total", { result: "mismatch" }, () =>
        runMutation(
          db,
          user,
          "request-1",
          { type: "remove", key: storageKey },
          async () => 0,
        ).catch(() => undefined),
      ),
    ).toBe(1);
    expect(
      await delta(
        "storage_operations_total",
        { operation: "clear", transport: "internal", outcome: "error" },
        () =>
          runMutation(db, user, undefined, { type: "clear" }, async () => {
            throw new Error("boom");
          }).catch(() => undefined),
      ),
    ).toBe(1);
    expect(
      await delta("versioning_operations_total", { operation: "commit", outcome: "ok" }, () =>
        runMutation(db, user, undefined, { type: "commit" }, async () => ({})),
      ),
    ).toBe(1);
    expect(
      await delta("versioning_operations_total", { operation: "fork", outcome: "rejected" }, () =>
        new VersioningService(db, {} as any).fork(user, { name: "main" }).catch(() => undefined),
      ),
    ).toBe(1);
  });

  test("conflicts, history, client sessions, deliveries and SSO are counted", async () => {
    const created: any[] = [];
    const conflicts = new ConflictResolutionService({
      orm: { sync_conflicts: { create: async (data: any) => (created.push(data), data) } },
    } as any);
    expect(
      await delta("conflicts_detected_total", { type: "version_mismatch" }, () =>
        conflicts.createConflict("item", user, { type: "version_mismatch" }),
      ),
    ).toBe(1);
    const repository = new SyncStorageRepository(database().db);
    expect(
      await delta("history_snapshots_total", {}, () =>
        (repository as any).snapshot({ _id: "r", userId: user, key: storageKey, version: 1 }),
      ),
    ).toBe(1);
    expect(
      await delta("client_sessions_issued_total", {}, async () =>
        issueClientSession({ id: "plain-id", key: "plain-secret" }, user, "main"),
      ),
    ).toBe(1);

    const gateway = new SyncStorageGateway(
      {} as any,
      {} as any,
      {
        canReceive: async (data: any) => data.allowed,
      } as any,
      {} as any,
    );
    gateway.server = {
      in: () => ({
        fetchSockets: async () => [
          { id: "a", data: { allowed: true } },
          { id: "b", data: { allowed: false } },
        ],
      }),
    } as any;
    const before = await value("realtime_deliveries_total", { result: "skipped" });
    expect(
      await delta("realtime_deliveries_total", { result: "delivered" }, () =>
        gateway.recipientRooms(user, storageKey),
      ),
    ).toBe(1);
    expect((await value("realtime_deliveries_total", { result: "skipped" })) - before).toBe(1);

    Object.assign(process.env, {
      SSO_ISSUER: "https://id.example/",
      SSO_CLIENT_ID: "console",
      SSO_REDIRECT_URI: "https://sync.example/api/v1/sso/callback",
      SSO_ALLOWED_DOMAINS: "example.com",
    });
    // SSO reads its settings on every call, so they must stay set until the call returns.
    const sso = new SsoService({} as any, {} as any);
    expect(
      await delta("sso_sign_ins_total", { outcome: "refused" }, () =>
        sso.complete({ error: "access_denied" }, undefined).catch(() => undefined),
      ),
    ).toBe(1);
    for (const name of ["SSO_ISSUER", "SSO_CLIENT_ID", "SSO_REDIRECT_URI", "SSO_ALLOWED_DOMAINS"])
      delete process.env[name];
    expect(
      await delta("sso_sign_ins_total", { outcome: "not_allowed" }, () =>
        metrics.signIn(Promise.reject(new ForbiddenException("no"))).catch(() => undefined),
      ),
    ).toBe(1);
  });

  test("Socket.IO events and MCP calls are counted by the global interceptor", async () => {
    const interceptor = new MetricsInterceptor();
    const handler = function handleSetItem() {};
    Reflect.defineMetadata("message", "sync:set", handler);
    const ws = { getType: () => "ws", getHandler: () => handler } as any;
    let seen: string | undefined;
    expect(
      await delta("socket_events_total", { event: "sync:set", outcome: "error" }, () =>
        lastValueFrom(
          interceptor.intercept(ws, {
            handle: () => ((seen = transport.getStore()), of({ type: "error" })),
          }),
        ),
      ),
    ).toBe(1);
    expect(seen).toBe("socket");
    const mcp = {
      getType: () => "mcp",
      getArgs: () => [{}, { kind: "tool", name: "set_item" }],
      getClass: () => Object,
      getHandler: () => handler,
    } as any;
    expect(
      await delta("mcp_calls_total", { kind: "tool", name: "set_item", outcome: "ok" }, () =>
        lastValueFrom(interceptor.intercept(mcp, { handle: () => of({ content: [] }) })),
      ),
    ).toBe(1);
    expect(
      await delta("mcp_calls_total", { kind: "tool", name: "set_item", outcome: "error" }, () =>
        lastValueFrom(interceptor.intercept(mcp, { handle: () => of({ isError: true }) })),
      ),
    ).toBe(1);
  });
});

describe("scrape-time sources", () => {
  test("a failing source sets scrape_error and keeps every other source", async () => {
    const fresh = new MetricsService();
    await readSharedState(database({ failing: "sync_archives" }).db, fresh);
    const text = await fresh.registry.metrics();
    expect(text).toContain('sync_store_scrape_error{source="collection_counts"} 1');
    expect(text).toContain('sync_store_scrape_error{source="mongodb_ping"} 0');
    expect(text).toContain(
      'sync_store_collection_documents{collection="storage_history",scope="cluster"} 7',
    );
    expect(text).toContain('sync_store_outbox_pending_events{tenant="acme",scope="cluster"} 5');
    expect(text).not.toContain('tenant="*"');
    expect(text).toContain(
      'sync_store_storage_history_versions{tenant="acme",project="web",scope="cluster"} 6',
    );
    expect(text).toMatch(/sync_store_mongodb_ping_seconds \d/);

    await readSharedState(database({ failing: "ping" }).db, fresh);
    const down = await fresh.registry.metrics();
    expect(down).toContain('sync_store_scrape_error{source="mongodb_ping"} 1');
    expect(down).toMatch(/^sync_store_mongodb_ping_seconds nan$/im);
    expect(down).toContain('sync_store_scrape_error{source="collection_counts"} 0');
  });
});

// Set up at module level, as mcp.test.ts does: a booting beforeAll can time out under Bun 1.4.
const scraped = database();
const moduleRef = await Test.createTestingModule({
  controllers: [MetricsController],
  providers: [
    { provide: Database, useValue: scraped.db },
    { provide: ApiKeyGuard, useValue: new ApiKeyGuard(scraped.db) },
    { provide: MetricsService, useValue: metrics },
  ],
}).compile();
// Configured as main.ts configures the application; inject() needs no port.
const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
app.setGlobalPrefix("api", { exclude: ["mcp", "metrics"] });
app.useGlobalInterceptors(new ResponseSerializerInterceptor(new Reflector()));
await app.init();
await app.getHttpAdapter().getInstance().ready();
const scrape = (authorization?: string) =>
  app.inject({ url: "/metrics", headers: authorization ? { authorization } : {} });

describe("GET /metrics", () => {
  const { writes } = scraped;
  afterAll(async () => {
    delete process.env.METRICS_TOKEN;
    await app.close();
  });

  test("refuses a missing or wrong credential with a short plain-text 401", async () => {
    process.env.METRICS_TOKEN = "scrape-token-0123456789";
    for (const authorization of [undefined, "Bearer wrong-token", "Basic abc"]) {
      const response = await scrape(authorization);
      expect(response.statusCode).toBe(401);
      expect(response.headers["content-type"]).toStartWith("text/plain");
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body.length).toBeLessThan(120);
    }
  });

  test("accepts the metrics token and an admin API key, not another key", async () => {
    process.env.METRICS_TOKEN = "scrape-token-0123456789";
    const token = await scrape("Bearer scrape-token-0123456789");
    expect(token.statusCode).toBe(200);
    expect(token.headers["content-type"]).toBe("text/plain; version=0.0.4; charset=utf-8");
    expect(token.headers["cache-control"]).toBe("no-store");
    expect(token.body).toStartWith("# HELP");
    expect(token.body).toContain("sync_store_build_info{");

    delete process.env.METRICS_TOKEN;
    expect((await scrape("Bearer scrape-token-0123456789")).statusCode).toBe(401);
    expect((await scrape("Bearer admin-secret")).statusCode).toBe(200);
    expect((await scrape("Bearer plain-secret")).statusCode).toBe(401);
    // A scrape charges no quota and writes no operational counters.
    expect(writes).toEqual([]);
    expect((await app.inject({ url: "/api/v1/metrics" })).statusCode).toBe(404);
  });

  test("no label value contains a user ID or a storage key", async () => {
    const body = (await scrape("Bearer admin-secret")).body;
    expect(body).not.toContain("user-secret-42");
    expect(body).not.toContain(storageKey);
    expect(body).not.toContain("admin-secret");
    expect(body).not.toContain("plain-secret");
  });
});

test("a token saved in the dashboard settings replaces the environment token", async () => {
  const { applyOverrides } = await import("../../src/domains/settings/settings.store");
  const { metricsToken } = await import("../../src/domains/metrics/metrics.service");
  const previous = process.env.METRICS_TOKEN;
  process.env.METRICS_TOKEN = "e".repeat(40);
  try {
    expect(metricsToken()).toBe("e".repeat(40));
    applyOverrides({ METRICS_TOKEN: "d".repeat(40) });
    expect(metricsToken()).toBe("d".repeat(40));
    // Removing it in the dashboard (an empty value) leaves no token, not the environment one.
    applyOverrides({ METRICS_TOKEN: "" });
    expect(metricsToken()).toBeUndefined();
  } finally {
    applyOverrides({});
    if (previous === undefined) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = previous;
  }
});
