import { createHash, timingSafeEqual } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Controller, Get, HttpException, Req, Res, VERSION_NEUTRAL } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { InjectDatabase, type Database } from "@root/modules/db";
import { resources } from "../admin/admin.service";
import { ApiKeyGuard } from "../sync-storage/guards/api-key.guard";
import { MetricsService, metricsToken } from "./metrics.service";

const maxTimeMS = 2000;
const cluster = "cluster";

/** Reject a source that hangs past its server-side limit, e.g. while no server can be selected. */
async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Scrape source timed out")), maxTimeMS + 500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** The rows of the most recent minute a shared snapshot collection holds. */
async function latest(db: Database, name: string) {
  const collection = db.native.collection<{ time: Date; [key: string]: any }>(name);
  const head = await collection.findOne(
    {},
    { sort: { time: -1 }, projection: { time: 1 }, maxTimeMS },
  );
  if (!head) return { time: null, rows: [] };
  const rows = await collection.find({ time: head.time }, { maxTimeMS }).limit(10_000).toArray();
  return { time: head.time, rows };
}

/**
 * Read the shared cluster state at scrape time: only cheap, time-limited queries, run concurrently.
 * A failed source leaves its gauges absent and sets `sync_store_scrape_error{source}` to 1.
 */
export async function readSharedState(db: Database, metrics: MetricsService) {
  const sources: Record<string, () => Promise<unknown>> = {
    mongodb_ping: async () => {
      // An unlabelled gauge cannot be absent: NaN until this ping answers.
      metrics.mongoPing.set(NaN);
      const start = performance.now();
      await db.native.command({ ping: 1, maxTimeMS });
      metrics.mongoPing.set((performance.now() - start) / 1000);
    },
    collection_counts: async () => {
      metrics.collectionDocuments.reset();
      const counts = await Promise.allSettled(
        Object.values(resources).map(async (collection) => {
          const count = await bounded(
            db.native.collection(collection).estimatedDocumentCount({ maxTimeMS }),
          );
          metrics.collectionDocuments.set({ collection, scope: cluster }, count);
        }),
      );
      const failed = counts.find((count) => count.status === "rejected");
      if (failed) throw failed.reason;
    },
    outbox_snapshot: async () => {
      for (const gauge of [metrics.outboxPending, metrics.outboxOldest]) gauge.reset();
      const { time, rows } = await latest(db, "operation_snapshots");
      if (time) metrics.snapshotTime.set({ source: "outbox", scope: cluster }, +time / 1000);
      for (const row of rows) {
        // "*" is the cluster total the operational report reads; sum the tenants instead.
        if (!row.tenantId || row.tenantId === "*") continue;
        const labels = { tenant: String(row.tenantId), scope: cluster };
        metrics.outboxPending.set(labels, Number(row.pending ?? 0));
        metrics.outboxOldest.set(labels, Number(row.oldestAgeMs ?? 0) / 1000);
      }
    },
    storage_snapshot: async () => {
      const gauges = [
        [metrics.storageItems, "items"],
        [metrics.storageValueBytes, "valueBytes"],
        [metrics.historyBytes, "historyBytes"],
        [metrics.historyVersions, "historyVersions"],
      ] as const;
      for (const [gauge] of gauges) gauge.reset();
      const { time, rows } = await latest(db, "operation_growth");
      if (time) metrics.snapshotTime.set({ source: "storage", scope: cluster }, +time / 1000);
      for (const row of rows) {
        const labels = {
          tenant: String(row.tenantId),
          project: String(row.project),
          scope: cluster,
        };
        for (const [gauge, field] of gauges) gauge.set(labels, Number(row[field] ?? 0));
      }
    },
  };
  await Promise.all(
    Object.entries(sources).map(async ([source, read]) => {
      try {
        await bounded(read());
        metrics.scrapeError.set({ source }, 0);
      } catch {
        metrics.scrapeError.set({ source }, 1);
      }
    }),
  );
}

/** Compare digests so neither the content nor the length of the configured token leaks. */
function sameSecret(received: string, expected: string) {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(received), digest(expected));
}

/** Prometheus scrape endpoint: `GET /metrics`, outside the API prefix and version. */
@ApiExcludeController()
@Controller({ path: "metrics", version: VERSION_NEUTRAL })
export class MetricsController {
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly keys: ApiKeyGuard,
    private readonly metrics: MetricsService,
  ) {}

  @Get()
  async scrape(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    reply.header("cache-control", "no-store");
    if (!(await this.authorized(request)))
      return reply
        .code(401)
        .header("www-authenticate", 'Bearer realm="metrics"')
        .type("text/plain; charset=utf-8")
        .send("Unauthorized: send Authorization: Bearer <metrics token or admin API key>\n");
    await readSharedState(this.db, this.metrics);
    return reply
      .type(this.metrics.registry.contentType)
      .send(await this.metrics.registry.metrics());
  }

  /** The metrics token, or an API key with the admin scope; neither is charged to a quota. */
  private async authorized(request: FastifyRequest) {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) return false;
    const configured = metricsToken();
    if (configured && sameSecret(token, configured)) return true;
    const equivalent = {
      headers: {
        ...request.headers,
        "x-user-id": "metrics",
        "x-instance-id": "metrics",
        "x-branch": "main",
      },
      method: "GET",
      url: "/metrics",
      body: {},
      params: {},
      query: {},
      protocol: request.protocol,
      ip: request.ip,
      socket: request.socket ?? {},
      transport: "metrics",
    };
    try {
      await this.keys.authorize(equivalent as any, "admin", token, false);
      return true;
    } catch (error) {
      if (error instanceof HttpException) return false;
      throw error;
    }
  }
}
