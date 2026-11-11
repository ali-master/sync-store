import { memo, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Activity, RefreshCw, X } from "lucide-react";
import { LineChart, LineChartPlot, LineChartTooltip } from "@/components/charts/line-chart";
import {
  Alert,
  AlertAction,
  AlertContent,
  AlertDescription,
  AlertTitle,
} from "@/components/motion/alert";
import { AnimatedBadge } from "@/components/motion/animated-badge";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { Button } from "@/components/motion/button/base";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/motion/card";
import { Input } from "@/components/motion/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/motion/select";
import { Table } from "@/components/motion/table";
import type { TableColumn } from "@/components/motion/table/types";
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";
import { TextShimmer } from "@/components/motion/text-shimmer";
import { RecordsTable } from "@/components/records-table";
import type { Row } from "@/lib/console";
import { reportCsv } from "@/lib/report-csv";

type Request = (
  path: string,
  method?: string,
  body?: unknown,
  key?: string,
  signal?: AbortSignal,
) => Promise<any>;

const tone = (index: number) => `var(--chart-${(index % 5) + 1})`;
const whole = (value: number) => value.toLocaleString();
const helper = "text-xs font-medium text-muted-foreground";
const note = "text-xs leading-relaxed text-muted-foreground";

// Axis labels sit about 64px apart, so they stay short: minute buckets span at most a day, hour
// buckets up to a month.
const minuteStamp = { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
const hourStamp = { month: "numeric", day: "numeric", hour: "numeric" };

/**
 * One slot per report interval between start and end. A slot without a recorded row stays empty,
 * so a chart draws a gap there instead of a zero.
 */
function intervals(rows: Row[], start: number, end: number, step: number) {
  const parts = (step < 3600000 ? minuteStamp : hourStamp) as Intl.DateTimeFormatOptions;
  const stamp = new Intl.DateTimeFormat(undefined, parts);
  const stampZone = new Intl.DateTimeFormat(undefined, { ...parts, timeZoneName: "short" });
  const count = step > 0 && end > start ? Math.ceil((end - start) / step) : 0;
  const slots: (Row | null)[] = Array(count).fill(null);
  for (const row of rows) {
    const time = +new Date(row.time);
    if (time >= start && time < end) slots[Math.floor((time - start) / step)] = row;
  }
  const first = Math.ceil(start / step) * step;
  const seen = new Set<string>();
  const labels = slots.map((row, index) => {
    const time = row ? +new Date(row.time) : first + index * step;
    let label = stamp.format(time);
    // Clocks going back repeat a local hour. Charts key intervals by label, so keep both distinct.
    if (seen.has(label)) label = stampZone.format(time);
    if (seen.has(label)) label = new Date(time).toISOString();
    seen.add(label);
    return label;
  });
  return { slots, labels };
}

/** Keep absent samples visible as gaps; every value is also exposed in the chart's data table. */
export const Trend = memo(function Trend({
  title,
  rows,
  field,
  unit = "",
  start,
  end,
  step,
  onSelect,
  color = "var(--chart-1)",
}: {
  title: string;
  rows: Row[];
  field: string;
  unit?: string;
  start: number;
  end: number;
  step: number;
  onSelect: (row: Row) => void;
  color?: string;
}) {
  const { slots, labels, values } = useMemo(() => {
    const { slots, labels } = intervals(rows, start, end, step);
    return {
      slots,
      labels,
      values: slots.map((row) => (Number.isFinite(row?.[field]) ? (row?.[field] as number) : null)),
    };
  }, [rows, field, start, end, step]);
  const series = useMemo(
    () => [{ id: field, name: title, color, values }],
    [field, title, color, values],
  );
  const present = values.filter((value) => value !== null);
  const format = (value: number) => whole(value) + (unit ? " " + unit : "");
  // The chart reports the inspected interval; a press or Enter on its inspector opens that row.
  const inspected = useRef<string | null>(null);
  const open = (target: EventTarget) => {
    if (!(target instanceof HTMLInputElement)) return;
    const index = labels.indexOf(inspected.current ?? "");
    const row = slots[index];
    if (row && values[index] !== null) onSelect(row);
  };
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle as="h2">{title}</CardTitle>
        <CardDescription>
          {present.length
            ? `${whole(present.length)} of ${whole(slots.length)} intervals sampled · maximum ${format(Math.max(...present))}`
            : "Missing intervals are gaps, not zero."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {present.length ? (
          <LineChart
            series={series}
            categories={labels}
            variant="area"
            curve="linear"
            formatValue={format}
            label={unit ? `${title}, ${unit}` : title}
            labels={{ inspect: "{label}: inspect values, Enter opens the interval detail" }}
            onActiveChange={(id) => {
              inspected.current = id;
            }}
            onClick={(event) => open(event.target)}
            onKeyDown={(event) => {
              if (event.key === "Enter") open(event.target);
            }}
          >
            <LineChartPlot height={200} />
            <LineChartTooltip />
          </LineChart>
        ) : (
          <div className="grid h-57 place-content-center justify-items-center gap-3 text-center text-sm text-muted-foreground">
            <span className="grid size-10 place-items-center rounded-xl bg-muted">
              <Activity className="size-5" aria-hidden="true" />
            </span>
            No samples in this period
          </div>
        )}
      </CardContent>
    </Card>
  );
});

const hoursOfDay = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0") + ":00");
const usageTitles: Record<string, string> = {
  httpRequests: "HTTP requests",
  httpErrors: "HTTP errors",
  http429: "HTTP 429 responses",
};
const intervalLabels = { time: "Time", p95UpperMs: "p95 upper (ms)" };
const intervalDisplay = (value: any) => (value == null ? "—" : String(value));
const count = (value: unknown) => (
  <span className="tabular-nums">{typeof value === "number" ? whole(value) : "—"}</span>
);
const changedKeyColumns: TableColumn<Row>[] = [
  { key: "project", header: "Project", cell: (row) => row._id.project || "—" },
  {
    key: "key",
    header: "Key",
    cell: (row) => <span className="font-mono text-xs break-all">{row._id.key}</span>,
  },
  { key: "changes", header: "Changes", align: "right", cell: (row) => count(row.changes) },
];

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
  const replicaLabel = useId();
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
  // Stable between refetches, so typing in a field does not redraw every chart.
  const rows = useMemo<Row[]>(
    () => data?.series?.filter((row: Row) => +new Date(row.time) >= start) ?? [],
    [data, start],
  );
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
  const views = saved.data?.filter((view) => view.kind === kind) ?? [];
  const savedError = save.error || saved.error || remove.error;
  const trend = { rows, start, end, step: data?.step, onSelect: setSelected };
  const consumerColumns = useMemo<TableColumn<Row>[]>(
    () => [
      { key: "project", header: "Project", cell: (row) => row.project || "—" },
      {
        key: "_id",
        header: "Key ID",
        cell: (row) => <span className="font-mono text-xs break-all">{row._id}</span>,
      },
      { key: "admitted", header: "Admissions", align: "right", cell: (row) => count(row.admitted) },
      {
        key: "quotaRejections",
        header: "Rejections",
        align: "right",
        cell: (row) => count(row.quotaRejections),
      },
      {
        key: "filter",
        header: <span className="sr-only">Filter</span>,
        align: "right",
        width: "96px",
        cell: (row) => (
          <Button
            variant="outline"
            size="sm"
            aria-label={`Show usage for key ${row._id}`}
            onClick={() => {
              setFilters((current) => ({ ...current, apiKeyId: row._id }));
              setPage(1);
            }}
          >
            Filter
          </Button>
        ),
      },
    ],
    [],
  );

  function exportCsv() {
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
  }

  return (
    <section className="space-y-6">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <div className="grid gap-2">
            <span className={helper}>Time range</span>
            <Tabs
              value={hours}
              onValueChange={(value) => {
                if (value === hours) return;
                setHours(value);
                setPage(1);
                setSelected(null);
              }}
            >
              <TabsList aria-label="Time range">
                <TabsTrigger value="1">Last hour</TabsTrigger>
                <TabsTrigger value="24">24 hours</TabsTrigger>
                <TabsTrigger value="168">7 days</TabsTrigger>
                <TabsTrigger value="720">30 days</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          {kind === "health" && (
            <div role="group" aria-labelledby={replicaLabel} className="grid gap-2">
              <span id={replicaLabel} className={helper}>
                Replica
              </span>
              <Select
                className="w-52"
                value={replica}
                onValueChange={(value) => {
                  if (value === replica) return;
                  setReplica(value);
                  setPage(1);
                }}
              >
                <SelectTrigger>
                  {/* The replica list reloads with the report; keep naming the active filter. */}
                  <SelectValue placeholder={replica || "All replicas"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All replicas</SelectItem>
                  {data?.replicas?.map((name: string) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button
            variant="outline"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw
              className={"size-4" + (query.isFetching ? " animate-spin" : "")}
              aria-hidden="true"
            />
            Refresh
          </Button>
        </CardContent>
        {kind !== "health" && (
          <CardContent>
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
              <Input
                label="Project ID"
                defaultValue={filters.project}
                name="project"
                maxLength={128}
                placeholder="All projects"
                className="w-full sm:w-60"
                classNames={{ input: "font-mono text-sm" }}
              />
              {kind === "usage" && (
                <Input
                  label="API key ID"
                  defaultValue={filters.apiKeyId}
                  name="apiKeyId"
                  maxLength={128}
                  placeholder="All keys (not a secret)"
                  className="w-full sm:w-60"
                  classNames={{ input: "font-mono text-sm" }}
                />
              )}
              <Button variant="primary" type="submit">
                Apply filters
              </Button>
            </form>
          </CardContent>
        )}
        <CardContent className={note}>
          UTC buckets · local display · refreshes every minute
          {data && (
            <>
              {" "}
              · {new Date(start).toLocaleString()} – {new Date(end).toLocaleString()}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Saved views</CardTitle>
          <CardDescription>
            Saved views share filters with installation administrators; they do not freeze report
            results.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <Input
              label="Report name"
              maxLength={80}
              value={reportName}
              onChange={setReportName}
              placeholder="Weekly operations review"
              className="w-full sm:w-72"
            />
            <Button
              variant="primary"
              disabled={!reportName.trim() || save.isPending}
              onClick={() => save.mutate()}
            >
              Save view
            </Button>
            <Button variant="outline" disabled={!data} onClick={exportCsv}>
              Export CSV
            </Button>
          </div>
          {savedError && (
            <Alert variant="destructive" role="alert">
              <AlertContent>
                <AlertTitle>Saved views request failed</AlertTitle>
                <AlertDescription>{savedError.message}</AlertDescription>
              </AlertContent>
            </Alert>
          )}
          {views.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {views.map((view) => (
                <li key={view._id} className="flex items-center rounded-full border border-border">
                  <Button
                    variant="ghost"
                    size="sm"
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
                    size="icon"
                    className="rounded-full"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(view._id)}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {query.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          <TextShimmer>Loading recorded metrics…</TextShimmer>
        </p>
      )}
      {query.error && (
        <Alert variant="destructive" role="alert">
          <AlertContent>
            <AlertTitle>Report could not be loaded</AlertTitle>
            <AlertDescription>{query.error.message}</AlertDescription>
          </AlertContent>
          <AlertAction>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </AlertAction>
        </Alert>
      )}
      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {fields.map((field, i) => (
              <Card key={field} size="compact">
                <CardContent className="space-y-3">
                  <p className={"flex items-center gap-2 " + helper}>
                    <span
                      className="size-2 rounded-full"
                      style={{ background: tone(i) }}
                      aria-hidden="true"
                    />
                    {labels[i]}
                  </p>
                  <p className="text-3xl font-semibold tracking-tight tabular-nums">
                    {rows.length ? <AnimatedNumber value={total(rows, field)} /> : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    Previous period:{" "}
                    {previous.length ? total(previous, field).toLocaleString() : "no samples"}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className={note}>
            Select a point in a chart, or a row under Recorded intervals, to see every value
            recorded for that interval.
          </p>
          {kind === "health" ? (
            <>
              <div className="grid gap-4 xl:grid-cols-2">
                <Trend
                  {...trend}
                  title="Publication latency · p95 bucket upper bound"
                  unit="ms"
                  field="p95UpperMs"
                  color={tone(0)}
                />
                <Trend
                  {...trend}
                  title="Failed drain attempts"
                  field="publishFailures"
                  color={tone(1)}
                />
                <Trend
                  {...trend}
                  title="Pending events · entire cluster"
                  rows={data.snapshots}
                  field="pending"
                  color={tone(4)}
                />
                <Trend
                  {...trend}
                  title="Oldest pending event · entire cluster"
                  unit="ms"
                  rows={data.snapshots}
                  field="oldestAgeMs"
                  color={tone(4)}
                />
                <Trend
                  {...trend}
                  title="WebSocket connections"
                  field="connections"
                  color={tone(2)}
                />
                <Trend
                  {...trend}
                  title="WebSocket disconnections"
                  field="disconnections"
                  color={tone(3)}
                />
              </div>
              <p className={note}>
                Publication is not client acknowledgement. Retries can count the same event more
                than once. p95 is an upper bucket bound; values beyond 60 seconds are unavailable.
                Missing samples are gaps, not zero. Telemetry is best-effort and retained for{" "}
                {data.retentionDays} days.
              </p>
            </>
          ) : kind === "usage" ? (
            <>
              <div className="grid gap-4 xl:grid-cols-2">
                {[...fields, "httpRequests", "httpErrors", "http429"].map((field, i) => (
                  <Trend
                    {...trend}
                    key={field}
                    title={labels[i] ?? usageTitles[field]}
                    field={field}
                    color={tone(i)}
                  />
                ))}
              </div>
              <Card>
                <CardHeader>
                  <CardTitle as="h2">Traffic by hour of day · UTC</CardTitle>
                  <CardDescription>
                    Admissions summed across sampled days in the selected period. An hour without
                    samples is a gap, not zero.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <LineChart
                    series={[
                      {
                        id: "admitted",
                        name: "Quota admissions",
                        color: tone(0),
                        values: hoursOfDay.map((_, hour) => {
                          const samples = rows.filter(
                            (row) => new Date(row.time).getUTCHours() === hour,
                          );
                          return samples.length ? total(samples, "admitted") : null;
                        }),
                      },
                    ]}
                    categories={hoursOfDay}
                    variant="area"
                    curve="linear"
                    formatValue={whole}
                    label="Quota admissions by hour of day, UTC"
                  >
                    <LineChartPlot height={200} />
                    <LineChartTooltip />
                  </LineChart>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle as="h2">Live quota outlook</CardTitle>
                  <CardDescription>
                    Top 50 active keys in this period, or the selected key. Forecast assumes
                    consumption continues at its current UTC-window average; it is not a guarantee.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {data.quotas.length ? (
                    <div className="grid gap-3 lg:grid-cols-2">
                      {data.quotas.map((quota: Row) => (
                        <Card key={quota.apiKeyId + quota.window} variant="muted" size="compact">
                          <CardContent className="space-y-2">
                            <div className="flex items-center justify-between gap-3">
                              <span className="truncate font-medium">
                                {quota.name || quota.apiKeyId}
                              </span>
                              <AnimatedBadge size="sm" status="neutral" showIcon={false}>
                                {quota.window}
                              </AnimatedBadge>
                            </div>
                            <p className="tabular-nums">
                              {quota.used.toLocaleString()} /{" "}
                              {quota.limit == null ? "Unlimited" : quota.limit.toLocaleString()}
                            </p>
                            {quota.percent != null && (
                              <progress
                                className="block h-2 w-full accent-primary"
                                max={100}
                                value={quota.percent}
                                aria-label={`${quota.name || quota.apiKeyId} ${quota.window} quota consumed`}
                              />
                            )}
                            <p className="text-xs text-muted-foreground">
                              Resets {new Date(quota.resetsAt).toLocaleString()}
                            </p>
                            <p
                              className={
                                "text-xs " +
                                (quota.estimatedExhaustionAt
                                  ? "text-warning"
                                  : "text-muted-foreground")
                              }
                            >
                              {quota.estimatedExhaustionAt
                                ? "Estimated exhaustion: " +
                                  new Date(quota.estimatedExhaustionAt).toLocaleString()
                                : "No exhaustion forecast before reset"}
                            </p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No keys matched. Enter a key ID to inspect an idle key.
                    </p>
                  )}
                </CardContent>
              </Card>
              <Card className="overflow-hidden">
                <CardHeader>
                  <CardTitle as="h2">Top consumers</CardTitle>
                  <CardDescription>
                    Keys with the most admissions in this period. Filter the report to one key.
                  </CardDescription>
                </CardHeader>
                <Table
                  data={data.topKeys}
                  columns={consumerColumns}
                  getRowId={(row) => String(row._id)}
                  emptyState={
                    <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                      No key was admitted in this period.
                    </p>
                  }
                />
              </Card>
              <p className={note}>
                Admissions include HTTP, socket handshakes and socket operations. Completed HTTP
                responses are counted separately. Quota rejection currently uses HTTP 403 and can
                include a concurrently disabled key; 429 is shown separately. Unauthorized
                credentials and administrator traffic are excluded. Missing samples are not zero
                traffic.
              </p>
            </>
          ) : (
            <>
              <div className="grid gap-4 xl:grid-cols-2">
                {[...fields, "conflicts"].map((field, i) => (
                  <Trend
                    {...trend}
                    key={field}
                    title={field[0].toUpperCase() + field.slice(1)}
                    field={field}
                    color={tone(i)}
                  />
                ))}
                {[
                  ["items", "Active items", "items"],
                  ["valueBytes", "Active JSON value size", "bytes"],
                  ["historyBytes", "Retained history BSON size", "bytes"],
                  ["historyVersions", "Retained versions", "versions"],
                ].map(([field, title, unit], i) => (
                  <Trend
                    {...trend}
                    key={field}
                    title={title}
                    unit={unit}
                    rows={data.growth}
                    field={field}
                    color={tone(i)}
                  />
                ))}
              </div>
              <Card className="overflow-hidden">
                <CardHeader>
                  <CardTitle as="h2">Most changed keys · top 50</CardTitle>
                </CardHeader>
                <Table
                  data={data.topKeys}
                  columns={changedKeyColumns}
                  getRowId={(row) => JSON.stringify(row._id)}
                  emptyState={
                    <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                      No key changed in this period.
                    </p>
                  }
                />
              </Card>
              <p className={note}>
                Mutation counts are transactional and start with this release. An idempotent retry
                is not another change. Conflicts count retained conflict records. Storage charts
                show logical JSON and BSON sizes, not compressed disk usage. History expiry can
                reduce retained volume. Snapshots are best-effort.
              </p>
            </>
          )}

          {selected && (
            <Card>
              <CardHeader>
                <CardTitle as="h2">
                  Selected interval · {new Date(selected.time).toLocaleString()}
                </CardTitle>
                <CardAction>
                  <Button variant="outline" size="sm" onClick={() => setSelected(null)}>
                    Close detail
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-4 sm:grid-cols-3 [&_dd]:mt-1 [&_dd]:font-medium [&_dd]:tabular-nums [&_dt]:font-mono [&_dt]:text-xs [&_dt]:text-muted-foreground">
                  {Object.entries(selected)
                    .filter(([key]) => !["_id", "time"].includes(key) && !/^latency\d/.test(key))
                    .map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>{value == null ? "—" : String(value)}</dd>
                      </div>
                    ))}
                </dl>
              </CardContent>
            </Card>
          )}
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle as="h2">Recorded intervals</CardTitle>
              <CardDescription>
                {tableRows.length.toLocaleString()} intervals with samples in this period
              </CardDescription>
              {kind !== "usage" && (
                <CardAction>
                  <Tabs
                    value={tableSource}
                    onValueChange={(value) => {
                      if (value === tableSource) return;
                      setTableSource(value);
                      setPage(1);
                    }}
                  >
                    <TabsList aria-label="Table source">
                      <TabsTrigger value="events">Event counts</TabsTrigger>
                      <TabsTrigger value="snapshots">Cluster snapshots</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </CardAction>
              )}
            </CardHeader>
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
              labels={intervalLabels}
              records={{
                items: tableRows.slice((page - 1) * 25, page * 25),
                total: tableRows.length,
              }}
              page={page}
              loading={query.isFetching}
              query=""
              onPageChange={setPage}
              onInspect={setSelected}
              display={intervalDisplay}
            />
          </Card>
        </>
      )}
    </section>
  );
}
