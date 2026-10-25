import { useState } from "react";
import { reportCsv } from "../lib/report-csv";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Activity, RefreshCw } from "lucide-react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { NativeSelect } from "./ui/native-select";
import { RecordsTable } from "./records-table";

type Row = Record<string, any>;
type Request = (
  path: string,
  method?: string,
  body?: unknown,
  key?: string,
  signal?: AbortSignal,
) => Promise<any>;

/** Keep absent samples visible as gaps; chart points also expose exact values in a table. */
export function Trend({
  title,
  rows,
  field,
  unit = "",
  start,
  end,
  step,
  onSelect,
}: {
  title: string;
  rows: Row[];
  field: string;
  unit?: string;
  start: number;
  end: number;
  step: number;
  onSelect: (row: Row) => void;
}) {
  const points = rows.filter(
    (row) =>
      +new Date(row.time) >= start && +new Date(row.time) < end && typeof row[field] === "number",
  );
  const max = Math.max(1, ...points.map((row) => row[field]));
  const x = (row: Row) => 16 + ((+new Date(row.time) - start) / Math.max(1, end - start)) * 568;
  const y = (row: Row) => 140 - (row[field] / max) * 115;
  return (
    <Card className="min-w-0 gap-3 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>
      {points.length ? (
        <svg
          viewBox="0 0 600 165"
          className="w-full"
          role="img"
          aria-label={`${title}: ${points.length} recorded samples; maximum ${max} ${unit}`}
        >
          {[25, 82, 140].map((y) => (
            <line key={y} x1="16" x2="584" y1={y} y2={y} stroke="currentColor" opacity=".08" />
          ))}
          {points.map((row, i) => (
            <g key={row.time}>
              {i > 0 && +new Date(row.time) - +new Date(points[i - 1].time) <= step * 1.5 && (
                <line
                  x1={x(points[i - 1])}
                  y1={y(points[i - 1])}
                  x2={x(row)}
                  y2={y(row)}
                  stroke="var(--primary)"
                  strokeWidth="2"
                />
              )}
              <circle
                cx={x(row)}
                cy={y(row)}
                r="3"
                fill="var(--primary)"
                onClick={() => onSelect(row)}
              >
                <title>
                  {new Date(row.time).toLocaleString()}: {row[field]} {unit}
                </title>
              </circle>
            </g>
          ))}
        </svg>
      ) : (
        <div className="grid h-40 place-content-center text-center text-sm text-muted-foreground">
          <Activity className="mx-auto mb-3 size-6" />
          No samples in this period
        </div>
      )}
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{new Date(start).toLocaleString()}</span>
        <span>{new Date(end).toLocaleString()}</span>
      </div>
    </Card>
  );
}

/** Read-only reports share the authenticated console connection and its query cache lifecycle. */
export function Reports({
  kind,
  request,
  sessionId,
}: {
  kind: string;
  request: Request;
  sessionId: string;
}) {
  const [hours, setHours] = useState("24");
  const [replica, setReplica] = useState("");
  const [filters, setFilters] = useState({ project: "", apiKeyId: "" });
  const [page, setPage] = useState(1);
  const [tableSource, setTableSource] = useState("events");
  const [reportName, setReportName] = useState("");
  const saved = useQuery<Row[]>({
    queryKey: ["console", sessionId, "saved-reports"],
    queryFn: ({ signal }) => request("reports/saved", "GET", undefined, undefined, signal),
  });
  const save = useMutation({
    mutationFn: () =>
      request("reports/saved", "POST", {
        name: reportName,
        kind,
        query: { hours, replica, ...filters },
      }),
    onSuccess: () => {
      setReportName("");
      void saved.refetch();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => request("reports/saved/" + id, "DELETE"),
    onSuccess: () => {
      void saved.refetch();
    },
  });
  const [selected, setSelected] = useState<Row | null>(null);
  const query = useQuery<Row>({
    queryKey: ["console", sessionId, "reports", kind, hours, replica, filters],
    queryFn: ({ signal }) =>
      request(
        `reports/${kind}?hours=${hours}&replica=${encodeURIComponent(replica)}&project=${encodeURIComponent(filters.project)}&apiKeyId=${encodeURIComponent(filters.apiKeyId)}`,
        "GET",
        undefined,
        undefined,
        signal,
      ),
    refetchInterval: 60000,
  });
  const data = query.data;
  const start = data ? +new Date(data.start) : 0,
    end = data ? +new Date(data.end) : 0;
  const rows: Row[] = data?.series?.filter((row: Row) => +new Date(row.time) >= start) ?? [];
  const tableRows: Row[] =
    tableSource === "events"
      ? rows
      : (data?.growth || data?.snapshots || []).filter((row: Row) => +new Date(row.time) >= start);
  const previous: Row[] = data?.series?.filter((row: Row) => +new Date(row.time) < start) ?? [];
  const total = (items: Row[], field: string) => items.reduce((n, row) => n + (row[field] || 0), 0);
  const fields =
    kind === "health"
      ? ["published", "publishFailures", "connections", "disconnections"]
      : kind === "usage"
        ? ["admitted", "reads", "writes", "quotaRejections"]
        : ["created", "updated", "deleted", "restored"];
  const labels =
    kind === "health"
      ? ["Publications", "Failed drain attempts", "Connections", "Disconnections"]
      : kind === "usage"
        ? ["Quota admissions", "Read admissions", "Write admissions", "Quota / disabled rejections"]
        : ["Created", "Updated", "Deleted", "Restored"];
  return (
    <section className="space-y-6">
      <Card className="flex-row flex-wrap items-end gap-4 p-5">
        <label className="grid gap-2 text-xs font-medium">
          Time range
          <NativeSelect
            value={hours}
            onChange={(e) => {
              setHours(e.target.value);
              setPage(1);
              setSelected(null);
            }}
          >
            <option value="1">Last hour</option>
            <option value="24">Last 24 hours</option>
            <option value="168">Last 7 days</option>
            <option value="720">Last 30 days</option>
          </NativeSelect>
        </label>
        {kind === "health" && (
          <label className="grid gap-2 text-xs font-medium">
            Replica
            <NativeSelect
              value={replica}
              onChange={(e) => {
                setReplica(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All replicas</option>
              {data?.replicas?.map((name: string) => (
                <option key={name}>{name}</option>
              ))}
            </NativeSelect>
          </label>
        )}
        <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw className="size-4" />
          Refresh
        </Button>
        <p className="text-xs text-muted-foreground">
          UTC buckets · local display · refreshes every minute
        </p>
      </Card>
      {kind !== "health" && (
        <form
          key={JSON.stringify(filters)}
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            setFilters({
              project: String(values.get("project") || ""),
              apiKeyId: String(values.get("apiKeyId") || ""),
            });
            setPage(1);
            setSelected(null);
          }}
        >
          <label className="grid gap-2 text-xs">
            Project ID
            <Input
              defaultValue={filters.project}
              name="project"
              maxLength={128}
              placeholder="All projects"
            />
          </label>
          {kind === "usage" && (
            <label className="grid gap-2 text-xs">
              API key ID
              <Input
                defaultValue={filters.apiKeyId}
                name="apiKeyId"
                maxLength={128}
                placeholder="All keys (not a secret)"
              />
            </label>
          )}
          <Button type="submit">Apply filters</Button>
        </form>
      )}
      <Card className="p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-2 text-xs">
            Report name
            <Input
              maxLength={80}
              value={reportName}
              onChange={(e) => setReportName(e.target.value)}
              placeholder="Weekly operations review"
            />
          </label>
          <Button disabled={!reportName.trim() || save.isPending} onClick={() => save.mutate()}>
            Save view
          </Button>
          <Button
            variant="outline"
            disabled={!data}
            onClick={() => {
              const records = [
                ...rows.map((row) => ({ ...row, source: "events" })),
                ...(data?.growth || data?.snapshots || [])
                  .filter((row: Row) => +new Date(row.time) >= start)
                  .map((row: Row) => ({ ...row, source: "snapshots" })),
                ...(data?.quotas || []).map((row: Row) => ({ ...row, source: "live-quotas" })),
              ];
              const csv = reportCsv(
                records.map((row) => ({
                  ...row,
                  report: kind,
                  projectFilter: filters.project,
                  keyFilter: filters.apiKeyId,
                  replicaFilter: replica,
                  rangeStart: data?.start,
                  rangeEnd: data?.end,
                })),
              );
              const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = `sync-store-${kind}.csv`;
              anchor.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            Export CSV
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Saved views share filters with installation administrators; they do not freeze report
          results.
        </p>
        {(save.error || saved.error || remove.error) && (
          <p role="alert" className="text-destructive">
            {(save.error || saved.error || remove.error)?.message}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {saved.data
            ?.filter((view) => view.kind === kind)
            .map((view) => (
              <div key={view._id} className="flex rounded-lg border">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setHours(view.query.hours || "24");
                    setReplica(view.query.replica || "");
                    setFilters({
                      project: view.query.project || "",
                      apiKeyId: view.query.apiKeyId || "",
                    });
                    setPage(1);
                    setSelected(null);
                  }}
                >
                  {view.name}
                </Button>
                <Button
                  aria-label={`Delete saved view ${view.name}`}
                  variant="ghost"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(view._id)}
                >
                  ×
                </Button>
              </div>
            ))}
        </div>
      </Card>
      {query.isPending && <p role="status">Loading recorded metrics…</p>}
      {query.error && (
        <p role="alert" className="text-destructive">
          {query.error.message}
        </p>
      )}
      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {fields.map((field, i) => (
              <Card key={field} className="gap-2 p-5">
                <p className="text-xs text-muted-foreground">{labels[i]}</p>
                <strong className="text-3xl tracking-tight">
                  {rows.length ? total(rows, field).toLocaleString() : "—"}
                </strong>
                <p className="text-xs text-muted-foreground">
                  Previous period:{" "}
                  {previous.length ? total(previous, field).toLocaleString() : "no samples"}
                </p>
              </Card>
            ))}
          </div>
          {kind === "health" ? (
            <>
              <div className="grid gap-5 xl:grid-cols-2">
                <Trend
                  title="Publication latency · p95 bucket upper bound"
                  unit="ms"
                  rows={rows}
                  field="p95UpperMs"
                  start={start}
                  end={end}
                  step={data.step}
                  onSelect={setSelected}
                />
                <Trend
                  title="Failed drain attempts"
                  rows={rows}
                  field="publishFailures"
                  start={start}
                  end={end}
                  step={data.step}
                  onSelect={setSelected}
                />
                <Trend
                  title="Pending events · entire cluster"
                  rows={data.snapshots}
                  field="pending"
                  start={start}
                  end={end}
                  step={data.step}
                  onSelect={setSelected}
                />
                <Trend
                  title="Oldest pending event · entire cluster"
                  unit="ms"
                  rows={data.snapshots}
                  field="oldestAgeMs"
                  start={start}
                  end={end}
                  step={data.step}
                  onSelect={setSelected}
                />
                <Trend
                  title="WebSocket connections"
                  rows={rows}
                  field="connections"
                  start={start}
                  end={end}
                  step={data.step}
                  onSelect={setSelected}
                />
                <Trend
                  title="WebSocket disconnections"
                  rows={rows}
                  field="disconnections"
                  start={start}
                  end={end}
                  step={data.step}
                  onSelect={setSelected}
                />
              </div>
              <p className="text-xs leading-6 text-muted-foreground">
                Publication is not client acknowledgement. Retries can count the same event more
                than once. p95 is an upper bucket bound; values beyond 60 seconds are unavailable.
                Missing samples are gaps, not zero. Telemetry is best-effort and retained for{" "}
                {data.retentionDays} days.
              </p>
            </>
          ) : kind === "usage" ? (
            <>
              <div className="grid gap-5 xl:grid-cols-2">
                {[...fields, "httpRequests", "httpErrors", "http429"].map((field) => (
                  <Trend
                    key={field}
                    title={field.replace(/([A-Z])/g, " $1")}
                    rows={rows}
                    field={field}
                    start={start}
                    end={end}
                    step={data.step}
                    onSelect={setSelected}
                  />
                ))}
              </div>
              <Card className="p-5">
                <h2 className="font-semibold">Traffic by hour of day · UTC</h2>
                <p className="text-xs text-muted-foreground">
                  Admissions summed across sampled days in the selected period.
                </p>
                <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
                  {Array.from({ length: 24 }, (_, hour) => {
                    const samples = rows.filter((row) => new Date(row.time).getUTCHours() === hour);
                    const count = total(samples, "admitted");
                    return (
                      <div key={hour} className="rounded-lg border p-2 text-center">
                        <p className="text-xs text-muted-foreground">
                          {String(hour).padStart(2, "0")}:00
                        </p>
                        <strong className="text-sm">
                          {samples.length ? count.toLocaleString() : "—"}
                        </strong>
                      </div>
                    );
                  })}
                </div>
              </Card>
              <Card className="p-5">
                <h2 className="font-semibold">Live quota outlook</h2>
                <p className="text-xs text-muted-foreground">
                  Top 50 active keys in this period, or the selected key. Forecast assumes
                  consumption continues at its current UTC-window average; it is not a guarantee.
                </p>
                <div className="grid gap-3 lg:grid-cols-2">
                  {data.quotas.map((quota: Row) => (
                    <div key={quota.apiKeyId + quota.window} className="rounded-lg border p-4">
                      <div className="flex justify-between gap-3">
                        <strong className="text-sm">{quota.name || quota.apiKeyId}</strong>
                        <span className="text-xs">{quota.window}</span>
                      </div>
                      <p className="mt-3 text-sm tabular-nums">
                        {quota.used.toLocaleString()} /{" "}
                        {quota.limit == null ? "Unlimited" : quota.limit.toLocaleString()}
                      </p>
                      {quota.percent != null && (
                        <progress
                          className="my-2 h-2 w-full accent-primary"
                          max={100}
                          value={quota.percent}
                          aria-label={`${quota.name} ${quota.window} quota consumed`}
                        />
                      )}
                      <p className="text-xs text-muted-foreground">
                        Resets {new Date(quota.resetsAt).toLocaleString()}
                      </p>
                      <p className="mt-1 text-xs">
                        {quota.estimatedExhaustionAt
                          ? "Estimated exhaustion: " +
                            new Date(quota.estimatedExhaustionAt).toLocaleString()
                          : "No exhaustion forecast before reset"}
                      </p>
                    </div>
                  ))}
                </div>
                {!data.quotas.length && (
                  <p className="text-sm text-muted-foreground">
                    No keys matched. Enter a key ID to inspect an idle key.
                  </p>
                )}
              </Card>
              <Card className="p-5">
                <h2 className="font-semibold">Top consumers</h2>
                {data.topKeys.map((key: Row) => (
                  <button
                    key={key._id}
                    className="flex w-full flex-wrap justify-between gap-2 border-b py-3 text-left text-sm hover:text-primary"
                    onClick={() => {
                      setFilters((current) => ({ ...current, apiKeyId: key._id }));
                      setPage(1);
                    }}
                  >
                    <span className="break-all">
                      {key.project} / {key._id}
                    </span>
                    <span>
                      {key.admitted} admissions · {key.quotaRejections} rejections
                    </span>
                  </button>
                ))}
              </Card>
              <p className="text-xs leading-6 text-muted-foreground">
                Admissions include HTTP, socket handshakes and socket operations. Completed HTTP
                responses are counted separately. Quota rejection currently uses HTTP 403 and can
                include a concurrently disabled key; 429 is shown separately. Unauthorized
                credentials and administrator traffic are excluded. Missing samples are not zero
                traffic.
              </p>
            </>
          ) : (
            <>
              <div className="grid gap-5 xl:grid-cols-2">
                {[...fields, "conflicts"].map((field) => (
                  <Trend
                    key={field}
                    title={field[0].toUpperCase() + field.slice(1)}
                    rows={rows}
                    field={field}
                    start={start}
                    end={end}
                    step={data.step}
                    onSelect={setSelected}
                  />
                ))}
                {[
                  ["items", "Active items", "items"],
                  ["valueBytes", "Active JSON value size", "bytes"],
                  ["historyBytes", "Retained history BSON size", "bytes"],
                  ["historyVersions", "Retained versions", "versions"],
                ].map(([field, title, unit]) => (
                  <Trend
                    key={field}
                    title={title}
                    unit={unit}
                    rows={data.growth}
                    field={field}
                    start={start}
                    end={end}
                    step={data.step}
                    onSelect={setSelected}
                  />
                ))}
              </div>
              <Card className="p-5">
                <h2 className="font-semibold">Most changed keys · top 50</h2>
                {data.topKeys.map((row: Row) => (
                  <div
                    key={JSON.stringify(row._id)}
                    className="flex flex-wrap justify-between gap-3 border-b py-3 text-sm"
                  >
                    <span className="break-all">
                      {row._id.project} / {row._id.key}
                    </span>
                    <strong>{row.changes} changes</strong>
                  </div>
                ))}
              </Card>
              <p className="text-xs leading-6 text-muted-foreground">
                Mutation counts are transactional and start with this release. An idempotent retry
                is not another change. Conflicts count retained conflict records. Storage charts
                show logical JSON and BSON sizes, not compressed disk usage. History expiry can
                reduce retained volume. Snapshots are best-effort.
              </p>
            </>
          )}

          {selected && (
            <Card className="p-5">
              <h2 className="font-semibold">
                Selected interval · {new Date(selected.time).toLocaleString()}
              </h2>
              <dl className="grid gap-3 sm:grid-cols-3">
                {Object.entries(selected)
                  .filter(([key]) => !["_id", "time"].includes(key) && !/^latency\d/.test(key))
                  .map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-xs text-muted-foreground">{key}</dt>
                      <dd>{value == null ? "—" : String(value)}</dd>
                    </div>
                  ))}
              </dl>
              <Button variant="outline" onClick={() => setSelected(null)}>
                Close detail
              </Button>
            </Card>
          )}
          <Card className="p-5">
            <h2 className="font-semibold">Recorded intervals</h2>
            {kind !== "usage" && (
              <label className="grid gap-2 text-xs">
                Table source
                <NativeSelect
                  value={tableSource}
                  onChange={(event) => {
                    setTableSource(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="events">Event counts</option>
                  <option value="snapshots">Cluster snapshots</option>
                </NativeSelect>
              </label>
            )}
            <RecordsTable
              fields={
                tableSource === "snapshots"
                  ? [
                      "time",
                      ...(kind === "health"
                        ? ["pending", "oldestAgeMs"]
                        : ["items", "valueBytes", "historyBytes", "historyVersions"]),
                    ]
                  : [
                      "time",
                      ...fields,
                      ...(kind === "health"
                        ? ["p95UpperMs"]
                        : kind === "usage"
                          ? ["httpRequests", "httpErrors", "http429"]
                          : ["conflicts"]),
                    ]
              }
              labels={{ time: "Time", p95UpperMs: "p95 upper (ms)" }}
              records={{
                items: tableRows.slice((page - 1) * 25, page * 25),
                total: tableRows.length,
              }}
              page={page}
              loading={query.isFetching}
              query=""
              onPageChange={setPage}
              onInspect={setSelected}
              display={(value) => (value == null ? "—" : String(value))}
            />
          </Card>
        </>
      )}
    </section>
  );
}
