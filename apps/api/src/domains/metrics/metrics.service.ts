import { AsyncLocalStorage } from "node:async_hooks";
import { setting } from "../settings/settings.store";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { HttpException, Injectable } from "@nestjs/common";
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

/**
 * The one place the metrics token is read. Returns undefined when no token is configured, so only
 * administrator API keys can scrape.
 */
export function metricsToken(): string | undefined {
  // Database-first: the Metrics token saved in the dashboard Settings, else METRICS_TOKEN.
  return setting("METRICS_TOKEN");
}

/** Which transport the current call arrived on: set by `MetricsInterceptor` around each handler. */
export const transport = new AsyncLocalStorage<"http" | "socket" | "mcp">();

const seconds = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60];
const bytes = [100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000];
/** `OperationsService.latencyBounds` (milliseconds), in seconds. */
const outboxSeconds = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 5, 15, 60];

/** Default collectors that run under Bun but report nothing or constant zeros. */
const silentUnderBun = [
  "nodejs_gc_duration_seconds",
  "nodejs_active_handles",
  "nodejs_active_handles_total",
  "nodejs_active_requests",
  "nodejs_active_requests_total",
  "nodejs_active_resources",
  "nodejs_active_resources_total",
  "nodejs_heap_space_size_total_bytes",
  "nodejs_heap_space_size_used_bytes",
  "nodejs_heap_space_size_available_bytes",
];

const authReasons: [RegExp, string][] = [
  [/^API key is required/, "missing"],
  [/identifiers are required/, "identity"],
  [/expired/i, "expired"],
  [/^Tenant is inactive/, "inactive_tenant"],
  [/scope|cannot administer/i, "scope"],
  [/quota exceeded/i, "quota"],
  [/^Invalid or inactive API key|^Invalid client session|^Unauthenticated socket/, "invalid"],
  [
    /permission is required|identity does not match|Branch does not exist|requires? unrestricted|requires read access|permitted prefixes/,
    "permission",
  ],
];

/** Why the API-key guard refused a request; anything else it forbids is a key restriction. */
function authReason(error: unknown): string {
  if (!(error instanceof HttpException)) return "error";
  const reason = authReasons.find(([pattern]) => pattern.test(error.message))?.[1];
  if (reason) return reason;
  return error.getStatus() === 403
    ? "restriction"
    : error.getStatus() === 401
      ? "invalid"
      : "error";
}

/** `ok`, `rejected` for a request the server refused (4xx), or `error`. */
function outcome(error?: unknown) {
  if (error === undefined) return "ok";
  return error instanceof HttpException && error.getStatus() < 500 ? "rejected" : "error";
}

function packageVersion() {
  try {
    return JSON.parse(readFileSync(join(__dirname, "../../../package.json"), "utf8")).version;
  } catch {
    return "unknown";
  }
}

/** Owns the Prometheus registry and every metric the API exposes at `GET /metrics`. */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  private counter<L extends string>(name: string, help: string, labelNames: L[] = []) {
    return new Counter<L>({
      name: "sync_store_" + name,
      help,
      labelNames,
      registers: [this.registry],
    });
  }
  private gauge<L extends string>(name: string, help: string, labelNames: L[] = []) {
    return new Gauge<L>({
      name: "sync_store_" + name,
      help,
      labelNames,
      registers: [this.registry],
    });
  }
  private histogram<L extends string>(
    name: string,
    help: string,
    labelNames: L[],
    buckets: number[],
  ) {
    return new Histogram<L>({
      name: "sync_store_" + name,
      help,
      labelNames,
      buckets,
      registers: [this.registry],
    });
  }

  readonly buildInfo = this.gauge("build_info", "Build and runtime of this replica; always 1.", [
    "version",
    "runtime",
    "node_env",
  ]);

  readonly httpRequests = this.counter("http_requests_total", "Completed HTTP requests.", [
    "method",
    "route",
    "status_code",
  ]);
  readonly httpDuration = this.histogram(
    "http_request_duration_seconds",
    "HTTP request duration, from the first byte received to the response sent.",
    ["method", "route", "status_code"],
    seconds,
  );
  readonly httpInFlight = this.gauge("http_requests_in_flight", "HTTP requests being processed.");
  readonly httpRequestSize = this.histogram(
    "http_request_size_bytes",
    "HTTP request body size, from Content-Length.",
    ["method", "route"],
    bytes,
  );
  readonly httpResponseSize = this.histogram(
    "http_response_size_bytes",
    "HTTP response body size, for responses sent with a Content-Length (not compressed or streamed).",
    ["method", "route"],
    bytes,
  );

  readonly authorizations = this.counter(
    "api_key_authorizations_total",
    "API-key authorization decisions; result is allowed or the reason for the refusal.",
    ["transport", "result"],
  );
  readonly clientSessions = this.counter(
    "client_sessions_issued_total",
    "Short-lived client session tokens issued.",
  );

  readonly quotaAdmissions = this.counter(
    "quota_admissions_total",
    "Operations admitted and charged to an API key's quota.",
    ["tenant", "project", "operation"],
  );
  readonly quotaRejections = this.counter(
    "quota_rejections_total",
    "Operations refused because the API key's quota was exhausted.",
    ["tenant", "project"],
  );
  readonly tenantHttpRequests = this.counter(
    "tenant_http_requests_total",
    "Completed storage HTTP requests attributed to a tenant and project, as the usage report counts them.",
    ["tenant", "project", "outcome"],
  );

  readonly storageOperations = this.counter(
    "storage_operations_total",
    "Storage mutations by transport and outcome (ok, rejected, error).",
    ["operation", "transport", "outcome"],
  );
  readonly storageDuration = this.histogram(
    "storage_operation_duration_seconds",
    "Storage mutation duration, including the MongoDB transaction.",
    ["operation", "transport"],
    seconds,
  );
  readonly idempotency = this.counter(
    "idempotent_requests_total",
    "Mutations sent with a request ID: first execution, replay of a stored result, or key reused for another operation.",
    ["result"],
  );
  readonly conflicts = this.counter("conflicts_detected_total", "Write conflicts recorded.", [
    "type",
  ]);
  readonly conflictResolutions = this.counter(
    "conflict_resolutions_total",
    "Recorded conflicts resolved by strategy; status pending means manual resolution is still needed.",
    ["strategy", "status"],
  );
  readonly historySnapshots = this.counter(
    "history_snapshots_total",
    "Item versions written to the retained history.",
  );

  readonly socketConnections = this.counter(
    "socket_connections_total",
    "Authenticated Socket.IO connections.",
    ["tenant"],
  );
  readonly socketDisconnections = this.counter(
    "socket_disconnections_total",
    "Socket.IO disconnections of authenticated sockets.",
    ["tenant"],
  );
  readonly socketsConnected = this.gauge(
    "sockets_connected",
    "Authenticated Socket.IO connections open on this replica.",
    ["tenant"],
  );
  readonly socketEvents = this.counter(
    "socket_events_total",
    "Socket.IO events handled after authorization, by event name and outcome.",
    ["event", "outcome"],
  );
  readonly deliveries = this.counter(
    "realtime_deliveries_total",
    "Recipient sockets considered for a change event: delivered, or skipped because they may no longer read the key.",
    ["result"],
  );

  readonly outboxPublished = this.counter(
    "outbox_published_total",
    "Change events published from the outbox.",
    ["tenant"],
  );
  readonly outboxFailures = this.counter(
    "outbox_publish_failures_total",
    "Outbox drain attempts that failed; the event is retried after its lease expires.",
    ["tenant"],
  );
  readonly outboxLatency = this.histogram(
    "outbox_publish_latency_seconds",
    "Time from the change to its publication, including time queued in the outbox.",
    [],
    outboxSeconds,
  );
  readonly outboxPending = this.gauge(
    "outbox_pending_events",
    "Change events waiting in the outbox (cluster-wide snapshot; do not sum across replicas).",
    ["tenant", "scope"],
  );
  readonly outboxOldest = this.gauge(
    "outbox_oldest_pending_age_seconds",
    "Age of the oldest pending outbox event (cluster-wide snapshot; do not sum across replicas).",
    ["tenant", "scope"],
  );

  readonly versioning = this.counter(
    "versioning_operations_total",
    "Versioning commits, forks and commit restores by outcome.",
    ["operation", "outcome"],
  );
  readonly ssoSignIns = this.counter("sso_sign_ins_total", "Dashboard single sign-on attempts.", [
    "outcome",
  ]);

  readonly mcpCalls = this.counter("mcp_calls_total", "MCP tool, resource and prompt calls.", [
    "kind",
    "name",
    "outcome",
  ]);
  readonly mcpDuration = this.histogram(
    "mcp_call_duration_seconds",
    "MCP call duration.",
    ["kind", "name"],
    seconds,
  );

  readonly mongoPing = this.gauge(
    "mongodb_ping_seconds",
    "Round trip of a MongoDB ping from this replica, measured at scrape time; NaN when it failed.",
  );
  readonly collectionDocuments = this.gauge(
    "collection_documents",
    "Estimated documents per collection (cluster-wide; do not sum across replicas).",
    ["collection", "scope"],
  );
  readonly storageItems = this.gauge(
    "storage_items",
    "Live items in the latest storage snapshot (cluster-wide; do not sum across replicas).",
    ["tenant", "project", "scope"],
  );
  readonly storageValueBytes = this.gauge(
    "storage_value_bytes",
    "Logical value bytes of live items in the latest storage snapshot (cluster-wide).",
    ["tenant", "project", "scope"],
  );
  readonly historyBytes = this.gauge(
    "storage_history_bytes",
    "BSON bytes of retained history in the latest storage snapshot (cluster-wide).",
    ["tenant", "project", "scope"],
  );
  readonly historyVersions = this.gauge(
    "storage_history_versions",
    "Retained history versions in the latest storage snapshot (cluster-wide).",
    ["tenant", "project", "scope"],
  );
  readonly snapshotTime = this.gauge(
    "snapshot_timestamp_seconds",
    "Time of the shared snapshot the cluster-wide gauges were read from.",
    ["source", "scope"],
  );
  readonly scrapeError = this.gauge(
    "scrape_error",
    "1 when a scrape-time source could not be read; its gauges are then absent.",
    ["source"],
  );

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: "sync_store_" });
    const bun = process.versions.bun;
    if (bun)
      for (const name of silentUnderBun) this.registry.removeSingleMetric("sync_store_" + name);
    this.buildInfo.set(
      {
        version: packageVersion(),
        runtime: bun ? "bun " + bun : "node " + process.versions.node,
        node_env: process.env.NODE_ENV ?? "development",
      },
      1,
    );
  }

  /** Count, time and size every HTTP request, including unmatched routes. */
  instrument(fastify: FastifyInstance) {
    const started = new WeakMap<FastifyRequest, number>();
    const finish = (request: FastifyRequest, reply?: FastifyReply) => {
      const start = started.get(request);
      if (start === undefined) return;
      started.delete(request);
      this.httpInFlight.dec();
      const method = request.method;
      const route = request.routeOptions?.url ?? "unmatched";
      const labels = { method, route, status_code: reply ? String(reply.statusCode) : "aborted" };
      this.httpRequests.inc(labels);
      this.httpDuration.observe(labels, (performance.now() - start) / 1000);
      const received = Number(request.headers["content-length"]);
      if (received > 0) this.httpRequestSize.observe({ method, route }, received);
      const sent = Number(reply?.getHeader("content-length"));
      if (sent >= 0 && reply?.hasHeader("content-length"))
        this.httpResponseSize.observe({ method, route }, sent);
    };
    fastify.addHook("onRequest", async (request) => {
      started.set(request, performance.now());
      this.httpInFlight.inc();
    });
    fastify.addHook("onResponse", async (request, reply) => finish(request, reply));
    fastify.addHook("onRequestAbort", async (request) => finish(request));
  }

  /** Mirror the counters `OperationsService.record` persists for the operational reports. */
  operation(values: Record<string, number>, dimensions: { project?: string; tenantId?: string }) {
    const tenant = dimensions.tenantId || "default",
      project = dimensions.project || "default";
    if (values.admitted)
      this.quotaAdmissions.inc(
        { tenant, project, operation: values.writes ? "write" : "read" },
        values.admitted,
      );
    if (values.quotaRejections)
      this.quotaRejections.inc({ tenant, project }, values.quotaRejections);
    if (values.httpRequests)
      this.tenantHttpRequests.inc(
        {
          tenant,
          project,
          outcome: values.http429 ? "rate_limited" : values.httpErrors ? "error" : "ok",
        },
        values.httpRequests,
      );
    if (values.connections) {
      this.socketConnections.inc({ tenant }, values.connections);
      this.socketsConnected.inc({ tenant }, values.connections);
    }
    if (values.disconnections) {
      this.socketDisconnections.inc({ tenant }, values.disconnections);
      this.socketsConnected.dec({ tenant }, values.disconnections);
    }
    if (values.published) this.outboxPublished.inc({ tenant }, values.published);
    if (values.publishFailures) this.outboxFailures.inc({ tenant }, values.publishFailures);
  }

  /** Record one API-key authorization decision; `transport` is set on the request by its caller. */
  authorization(request: unknown, error?: unknown) {
    this.authorizations.inc({
      transport: (request as { transport?: string }).transport ?? "http",
      result: error === undefined ? "allowed" : authReason(error),
    });
  }

  /** Count the outcome of `work` under `labels` plus `outcome`, rethrowing its error. */
  async track<T, L extends string>(
    counter: Counter<L | "outcome">,
    labels: Partial<Record<L, string>>,
    work: Promise<T>,
  ): Promise<T> {
    try {
      const result = await work;
      counter.inc({ ...labels, outcome: outcome() } as Partial<Record<L | "outcome", string>>);
      return result;
    } catch (error) {
      counter.inc({ ...labels, outcome: outcome(error) } as Partial<Record<L | "outcome", string>>);
      throw error;
    }
  }

  /** Storage and versioning mutations all pass through `runMutation`; its payload names the operation. */
  mutation<T>(payload: unknown, work: () => Promise<T>): Promise<T> {
    const type = (payload as { type?: unknown } | null)?.type;
    if (type === "commit" || type === "restore-commit")
      return this.track(
        this.versioning,
        { operation: type === "commit" ? "commit" : "restore" },
        work(),
      );
    if (type !== "set" && type !== "remove" && type !== "clear" && type !== "restore")
      return work();
    const labels = { operation: type, transport: transport.getStore() ?? "internal" };
    const end = this.storageDuration.startTimer(labels);
    return this.track(this.storageOperations, labels, work()).finally(end);
  }

  /** success, refused by the identity provider or the request, not_allowed by the allow-list, or error. */
  async signIn<T>(work: Promise<T>): Promise<T> {
    try {
      const result = await work;
      this.ssoSignIns.inc({ outcome: "success" });
      return result;
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 500;
      this.ssoSignIns.inc({
        outcome: status === 403 ? "not_allowed" : status === 401 ? "refused" : "error",
      });
      throw error;
    }
  }
}

// ponytail: one process-wide instance so plain functions (mutations, client sessions) can count too;
// Nest injects this same object as MetricsService.
export const metrics = new MetricsService();
