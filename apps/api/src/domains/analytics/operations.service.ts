import { BadRequestException, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { hostname } from "node:os";
import { Database, InjectDatabase } from "@root/modules/db";
import { quotaWindows, quotaWindow } from "../sync-storage/services/quota-window";
import { accessPolicy } from "../sync-storage/services/access-policy";

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

/** Forecast using elapsed UTC-window consumption, capped by the next reset boundary. */
export function quotaForecast(unit: string, used: number, limit: number | null, now: Date) {
  const start = new Date(now),
    reset = new Date(now);
  if (unit === "month") {
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    reset.setUTCDate(1);
    reset.setUTCMonth(reset.getUTCMonth() + 1);
    reset.setUTCHours(0, 0, 0, 0);
  } else if (unit === "day") {
    start.setUTCHours(0, 0, 0, 0);
    reset.setUTCDate(reset.getUTCDate() + 1);
    reset.setUTCHours(0, 0, 0, 0);
  } else if (unit === "hour") {
    start.setUTCMinutes(0, 0, 0);
    reset.setUTCHours(reset.getUTCHours() + 1);
    reset.setUTCMinutes(0, 0, 0);
  } else {
    start.setUTCSeconds(0, 0);
    reset.setUTCMinutes(reset.getUTCMinutes() + 1);
    reset.setUTCSeconds(0, 0);
  }
  const elapsed = +now - +start;
  const estimate =
    limit === null || used <= 0 || elapsed < 1000
      ? null
      : (Math.max(0, limit - used) * elapsed) / used;
  return {
    used,
    limit,
    percent: limit === null ? null : limit === 0 ? 100 : Math.min(100, (used / limit) * 100),
    resetsAt: reset,
    estimatedExhaustionAt:
      estimate !== null && estimate < +reset - +now ? new Date(+now + estimate) : null,
  };
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

  /** Separate completed HTTP traffic from quota admissions, which also include WebSocket operations. */
  async usage(query: Record<string, string>) {
    const range = reportRange(query);
    const fields = [
      "httpRequests",
      "httpErrors",
      "http429",
      "admitted",
      "reads",
      "writes",
      "quotaRejections",
    ];
    const match = {
      time: { $gte: new Date(+range.start - range.hours * 3600000), $lt: range.end },
      apiKeyId: query.apiKeyId || { $ne: "" },
      ...(query.project ? { project: query.project } : {}),
    };
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
              ...Object.fromEntries(fields.map((field) => [field, { $sum: "$" + field }])),
            },
          },
          { $sort: { _id: 1 } },
        ],
        { maxTimeMS: 10000 },
      )
      .toArray();
    const topKeys = await this.db.native
      .collection("operation_metrics")
      .aggregate(
        [
          { $match: { ...match, time: { $gte: range.start, $lt: range.end } } },
          {
            $group: {
              _id: "$apiKeyId",
              project: { $first: "$project" },
              admitted: { $sum: "$admitted" },
              httpRequests: { $sum: "$httpRequests" },
              quotaRejections: { $sum: "$quotaRejections" },
            },
          },
          { $sort: { admitted: -1 } },
          { $limit: 50 },
        ],
        { maxTimeMS: 10000 },
      )
      .toArray();
    const keys = await this.db.native
      .collection("api_keys")
      .aggregate(
        [
          {
            $match: query.apiKeyId
              ? { _id: query.apiKeyId }
              : { _id: { $in: topKeys.map((row) => row._id) } },
          },
          {
            $project: {
              name: 1,
              metadata: 1,
              now: "$$NOW",
              ...Object.fromEntries(
                quotaWindows.flatMap((window) => [
                  [window.limit, 1],
                  [window.counter, quotaWindow(window).usage],
                ]),
              ),
            },
          },
        ],
        { maxTimeMS: 10000 },
      )
      .toArray();
    const quotas = keys
      .filter((key) => !query.project || accessPolicy(key).projectId === query.project)
      .flatMap((key) =>
        quotaWindows.map((window) => ({
          apiKeyId: key._id,
          name: key.name,
          project: accessPolicy(key).projectId,
          window: window.unit,
          ...quotaForecast(
            window.unit,
            Number(key[window.counter] ?? 0),
            key[window.limit] == null ? null : Number(key[window.limit]),
            key.now,
          ),
        })),
      );
    return {
      ...range,
      series: rows.map((row) => ({ ...row, time: row._id })),
      topKeys,
      quotas,
      retentionDays: 90,
      generatedAt: new Date(),
    };
  }
}
