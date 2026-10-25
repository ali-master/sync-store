import { BadRequestException, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { hostname } from "node:os";
import { Database, InjectDatabase } from "@root/modules/db";
import { quotaWindows, quotaWindow } from "../sync-storage/services/quota-window";
import { accessPolicy } from "../sync-storage/services/access-policy";
import { randomUUID } from "node:crypto";

// Project IDs are server-validated ASCII identifiers embedded in the storage namespace.
const projectExpression = {
  $let: {
    vars: { match: { $regexFind: { input: "$userId", regex: '^project:\\["([a-zA-Z0-9_-]+)"' } } },
    in: { $ifNull: [{ $arrayElemAt: ["$$match.captures", 0] }, "default"] },
  },
};

export const latencyBounds = [10, 50, 100, 250, 500, 1000, 5000, 15000, 60000];
const retentionMs = 90 * 86400000;

/** Validate bounded report queries before constructing MongoDB expressions. */
export function reportRange(query: Record<string, string>, now = Date.now()) {
  if (Object.values(query).some((value) => typeof value !== "string"))
    throw new BadRequestException("Report parameters must be strings");
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
  readonly replica = `${process.env.HOSTNAME || hostname()}:${process.pid}`;
  constructor(@InjectDatabase() private readonly db: Database) {}

  async onModuleInit() {
    for (const name of [
      "operation_metrics",
      "operation_snapshots",
      "operation_growth",
      "storage_change_events",
      "operation_snapshot_runs",
    ]) {
      await this.db.native
        .collection(name)
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      await this.db.native.collection(name).createIndex({ time: 1 });
    }
    await this.db.native.collection("storage_change_events").createIndex({ project: 1, time: 1 });
    await this.db.native.collection("sync_conflicts").createIndex({ createdAt: 1 });
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
    const time = new Date(Math.floor(Date.now() / 60000) * 60000);
    try {
      try {
        await this.db.native
          .collection<{ _id: string; expiresAt: Date }>("operation_snapshot_runs")
          .insertOne({ _id: time.toISOString(), expiresAt: new Date(+time + 86400000) });
      } catch (error) {
        if ((error as { code?: number }).code === 11000) return;
        throw error;
      }
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
      await this.growthSnapshot(time);
    } catch {
      this.logger.warn("Operational snapshot failed; report will contain a gap");
    }
  }

  /** Measure logical value bytes separately from retained history BSON size, not physical disk usage. */
  private async growthSnapshot(time: Date) {
    const [active, history, projects] = await Promise.all([
      this.db.native
        .collection("sync_storage_items")
        .aggregate(
          [
            {
              $group: {
                _id: projectExpression,
                items: { $sum: { $cond: ["$isDeleted", 0, 1] } },
                valueBytes: { $sum: { $cond: ["$isDeleted", 0, "$size"] } },
              },
            },
          ],
          { maxTimeMS: 10000 },
        )
        .toArray(),
      this.db.native
        .collection("storage_history")
        .aggregate(
          [
            {
              $group: {
                _id: projectExpression,
                historyVersions: { $sum: 1 },
                historyBytes: { $sum: { $bsonSize: "$$ROOT" } },
              },
            },
          ],
          { maxTimeMS: 10000 },
        )
        .toArray(),
      this.db.native
        .collection("projects")
        .find({}, { projection: { _id: 1 }, maxTimeMS: 10000 })
        .toArray(),
    ]);
    const ids = new Set([
      "default",
      ...projects.map((row) => String(row._id)),
      ...active.map((row) => row._id),
      ...history.map((row) => row._id),
    ]);
    const values = new Map(active.map((row) => [row._id, row])),
      versions = new Map(history.map((row) => [row._id, row]));
    await this.db.native
      .collection<{ _id: string; [key: string]: any }>("operation_growth")
      .bulkWrite(
        [...ids].map((project) => ({
          updateOne: {
            filter: { _id: JSON.stringify([time.toISOString(), project]) },
            update: {
              $set: {
                time,
                project,
                items: values.get(project)?.items ?? 0,
                valueBytes: Number(values.get(project)?.valueBytes ?? 0),
                historyVersions: versions.get(project)?.historyVersions ?? 0,
                historyBytes: versions.get(project)?.historyBytes ?? 0,
                expiresAt: new Date(+time + retentionMs),
              },
            },
            upsert: true,
          },
        })),
      );
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

  /** Aggregate durable mutation events without reading or returning customer JSON. */
  async changes(query: Record<string, string>) {
    const range = reportRange(query);
    const time = { $gte: new Date(+range.start - range.hours * 3600000), $lt: range.end };
    const match = { time, ...(query.project ? { project: query.project } : {}) };
    const bucket = {
      $dateTrunc: { date: "$time", unit: range.step === 60000 ? "minute" : "hour" },
    };
    const series = await this.db.native
      .collection("storage_change_events")
      .aggregate(
        [
          { $match: match },
          {
            $group: {
              _id: bucket,
              ...Object.fromEntries(
                ["created", "updated", "deleted", "restored"].map((action) => [
                  action,
                  { $sum: { $cond: [{ $eq: ["$action", action] }, 1, 0] } },
                ]),
              ),
            },
          },
          { $sort: { _id: 1 } },
        ],
        { maxTimeMS: 10000 },
      )
      .toArray();
    const conflicts = await this.db.native
      .collection("sync_conflicts")
      .aggregate(
        [
          { $match: { createdAt: time } },
          { $set: { project: projectExpression, time: "$createdAt" } },
          ...(query.project ? [{ $match: { project: query.project } }] : []),
          { $group: { _id: bucket, conflicts: { $sum: 1 } } },
        ],
        { maxTimeMS: 10000 },
      )
      .toArray();
    const merged = new Map<number, Record<string, any>>(
      series.map((row) => [+row._id, { ...row, time: row._id, conflicts: 0 }]),
    );
    for (const row of conflicts)
      merged.set(+row._id, {
        created: 0,
        updated: 0,
        deleted: 0,
        restored: 0,
        ...merged.get(+row._id),
        ...row,
        time: row._id,
      });
    const growth = await this.db.native
      .collection("operation_growth")
      .aggregate(
        [
          { $match: match },
          {
            $group: {
              _id: "$time",
              items: { $sum: "$items" },
              valueBytes: { $sum: "$valueBytes" },
              historyBytes: { $sum: "$historyBytes" },
              historyVersions: { $sum: "$historyVersions" },
            },
          },
          { $set: { time: "$_id" } },
          { $sort: { time: 1 } },
          {
            $group: {
              _id: bucket,
              items: { $last: "$items" },
              valueBytes: { $last: "$valueBytes" },
              historyBytes: { $last: "$historyBytes" },
              historyVersions: { $last: "$historyVersions" },
            },
          },
          { $sort: { _id: 1 } },
        ],
        { maxTimeMS: 10000 },
      )
      .toArray();
    const topKeys = await this.db.native
      .collection("storage_change_events")
      .aggregate(
        [
          { $match: { ...match, time: { $gte: range.start, $lt: range.end } } },
          { $group: { _id: { key: "$key", project: "$project" }, changes: { $sum: 1 } } },
          { $sort: { changes: -1 } },
          { $limit: 50 },
        ],
        { maxTimeMS: 10000 },
      )
      .toArray();
    return {
      ...range,
      series: [...merged.values()].sort((a, b) => +a.time - +b.time),
      growth: growth.map((row) => ({ ...row, time: row._id })),
      topKeys,
      retentionDays: 90,
      generatedAt: new Date(),
    };
  }

  /** Save bounded report definitions, never credentials or result payloads. */
  async saveReport(body: any, actor: string) {
    if (
      !body ||
      typeof body.name !== "string" ||
      !body.name.trim() ||
      body.name.length > 80 ||
      !["health", "usage", "changes"].includes(body.kind)
    )
      throw new BadRequestException("Invalid report name or kind");
    const query = body.query;
    if (
      !query ||
      typeof query !== "object" ||
      Array.isArray(query) ||
      Object.entries(query).some(
        ([key, value]) =>
          !["hours", "project", "apiKeyId", "replica"].includes(key) || typeof value !== "string",
      )
    )
      throw new BadRequestException("Invalid report filters");
    reportRange(query);
    const report = {
      _id: randomUUID(),
      name: body.name.trim(),
      kind: body.kind,
      query,
      actor,
      createdAt: new Date(),
    };
    await this.db.native
      .collection<{ _id: string; [key: string]: any }>("saved_reports")
      .insertOne(report);
    return report;
  }

  /** Shared administrator views are scoped to this installation and can be removed by any admin. */
  async savedReports() {
    return this.db.native
      .collection("saved_reports")
      .find({}, { projection: { actor: 0 } })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
  }

  async deleteReport(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new BadRequestException("Invalid report ID");
    await this.db.native.collection<{ _id: string }>("saved_reports").deleteOne({ _id: id });
    return { deleted: true };
  }
}
