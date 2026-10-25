import { BadRequestException, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { hostname } from "node:os";
import { Database, InjectDatabase } from "@root/modules/db";

export const latencyBounds = [10, 50, 100, 250, 500, 1000, 5000, 15000, 60000];
const retentionMs = 90 * 86400000;

/** Validate bounded report queries before constructing MongoDB expressions. */
export function reportRange(query: Record<string, string>, now = Date.now()) {
  const hours = Number(query.hours || 24);
  if (![1, 24, 168, 720].includes(hours)) throw new BadRequestException("Invalid report range");
  for (const name of ["replica", "project", "apiKeyId"])
    if (
      query[name] &&
      (query[name].length > 128 || [...query[name]].some((char) => char.charCodeAt(0) < 32))
    )
      throw new BadRequestException("Invalid report filter");
  const end = query.end ? new Date(query.end).getTime() : now;
  if (!Number.isFinite(end) || end > now + 60000 || end < now - 60 * 86400000)
    throw new BadRequestException("Report end must be within the past 60 days");
  return {
    start: new Date(end - hours * 3600000),
    end: new Date(end),
    hours,
    step: hours <= 24 ? 60000 : 3600000,
  };
}

/** Merge histogram counts before estimating a cluster percentile; never average node percentiles. */
export function percentile(buckets: number[], quantile: number) {
  const target = buckets.reduce((a, b) => a + b, 0) * quantile;
  if (!target) return null;
  let count = 0;
  for (let i = 0; i < buckets.length; i++) {
    count += buckets[i];
    if (count >= target) return latencyBounds[i] ?? null;
  }
  return null;
}

/** Store metadata-only minute counters across replicas; telemetry failure never blocks writes. */
@Injectable()
export class OperationsService implements OnModuleInit {
  private readonly logger = new Logger(OperationsService.name);
  readonly replica = process.env.HOSTNAME || hostname();
  constructor(@InjectDatabase() private readonly db: Database) {}

  async onModuleInit() {
    for (const name of ["operation_metrics", "operation_snapshots"]) {
      await this.db.native
        .collection(name)
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      await this.db.native.collection(name).createIndex({ time: 1 });
    }
  }

  /** Atomic increments avoid lost counts when multiple requests share a time bucket. */
  async record(
    values: Record<string, number>,
    dimensions: { project?: string; apiKeyId?: string } = {},
  ) {
    const time = new Date(Math.floor(Date.now() / 60000) * 60000);
    const project = dimensions.project ?? "",
      apiKeyId = dimensions.apiKeyId ?? "";
    const _id = JSON.stringify([time.toISOString(), this.replica, project, apiKeyId]);
    try {
      await this.db.native
        .collection<{ _id: string; [key: string]: any }>("operation_metrics")
        .updateOne(
          { _id },
          {
            $setOnInsert: {
              time,
              replica: this.replica,
              project,
              apiKeyId,
              expiresAt: new Date(+time + retentionMs),
            },
            $inc: values,
          },
          { upsert: true },
        );
    } catch {
      this.logger.warn("Operational metric was not persisted");
    }
  }

  /** Publication latency includes queued time; duplicates count as publication attempts. */
  published(timestamp: number) {
    const latency = Math.max(0, Date.now() - timestamp);
    const bucket = latencyBounds.findIndex((bound) => latency <= bound);
    return this.record({
      published: 1,
      latencySum: latency,
      ["latency" + (bucket < 0 ? latencyBounds.length : bucket)]: 1,
    });
  }

  /** A shared snapshot is overwritten, never summed once per replica. */
  @Cron("0 * * * * *")
  async snapshot() {
    try {
      const [pending] = await this.db.native
        .collection("sync_storage_items")
        .aggregate(
          [
            { $match: { "outbox.0": { $exists: true } } },
            {
              $group: {
                _id: null,
                pending: { $sum: { $size: "$outbox" } },
                oldest: { $min: { $arrayElemAt: ["$outbox.timestamp", 0] } },
              },
            },
          ],
          { maxTimeMS: 10000 },
        )
        .toArray();
      const time = new Date(Math.floor(Date.now() / 60000) * 60000);
      await this.db.native
        .collection<{ _id: string; [key: string]: any }>("operation_snapshots")
        .updateOne(
          { _id: time.toISOString() },
          {
            $set: {
              time,
              pending: pending?.pending ?? 0,
              oldestAgeMs: pending?.oldest ? Math.max(0, Date.now() - Number(pending.oldest)) : 0,
              expiresAt: new Date(+time + retentionMs),
            },
          },
          { upsert: true },
        );
    } catch {
      this.logger.warn("Operational snapshot failed; report will contain a gap");
    }
  }

  /** Return real sampled points, preserving missing intervals rather than inventing zero traffic. */
  async health(query: Record<string, string>) {
    const range = reportRange(query);
    const match = {
      time: { $gte: new Date(+range.start - range.hours * 3600000), $lt: range.end },
      ...(query.replica ? { replica: query.replica } : {}),
    };
    const fields = [
      "published",
      "publishFailures",
      "connections",
      "disconnections",
      "latencySum",
      ...Array.from({ length: latencyBounds.length + 1 }, (_, i) => "latency" + i),
    ];
    const rows = await this.db.native
      .collection("operation_metrics")
      .aggregate(
        [
          { $match: match },
          {
            $group: {
              _id: {
                $dateTrunc: { date: "$time", unit: range.step === 60000 ? "minute" : "hour" },
              },
              ...Object.fromEntries(fields.map((key) => [key, { $sum: "$" + key }])),
            },
          },
          { $sort: { _id: 1 } },
        ],
        { maxTimeMS: 10000 },
      )
      .toArray();
    const series = rows.map((row) => ({
      ...row,
      time: row._id,
      p95UpperMs: percentile(
        Array.from({ length: latencyBounds.length + 1 }, (_, i) => row["latency" + i]),
        0.95,
      ),
    }));
    const snapshots = await this.db.native
      .collection("operation_snapshots")
      .aggregate(
        [
          { $match: { time: match.time } },
          { $sort: { time: 1 } },
          {
            $group: {
              _id: {
                $dateTrunc: { date: "$time", unit: range.step === 60000 ? "minute" : "hour" },
              },
              pending: { $last: "$pending" },
              oldestAgeMs: { $last: "$oldestAgeMs" },
            },
          },
          { $sort: { _id: 1 } },
        ],
        { maxTimeMS: 10000 },
      )
      .toArray();
    const replicas = await this.db.native
      .collection("operation_metrics")
      .distinct("replica", { time: match.time });
    return {
      ...range,
      series,
      snapshots: snapshots.map((row) => ({ ...row, time: row._id })),
      replicas,
      retentionDays: 90,
      generatedAt: new Date(),
    };
  }
}
