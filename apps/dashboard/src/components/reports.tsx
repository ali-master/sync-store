import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, RefreshCw } from "lucide-react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
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
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Row | null>(null);
  const query = useQuery<Row>({
    queryKey: ["console", sessionId, "reports", kind, hours, replica],
    queryFn: ({ signal }) =>
      request(
        `reports/${kind}?hours=${hours}&replica=${encodeURIComponent(replica)}`,
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
  const previous: Row[] = data?.series?.filter((row: Row) => +new Date(row.time) < start) ?? [];
  const total = (items: Row[], field: string) => items.reduce((n, row) => n + (row[field] || 0), 0);
  const fields = ["published", "publishFailures", "connections", "disconnections"];
  const labels = ["Publications", "Failed drain attempts", "Connections", "Disconnections"];
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
        <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw className="size-4" />
          Refresh
        </Button>
        <p className="text-xs text-muted-foreground">
          UTC buckets · local display · refreshes every minute
        </p>
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
            Publication is not client acknowledgement. Retries can count the same event more than
            once. p95 is an upper bucket bound; values beyond 60 seconds are unavailable. Missing
            samples are gaps, not zero. Telemetry is best-effort and retained for{" "}
            {data.retentionDays} days.
          </p>
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
            <RecordsTable
              fields={["time", ...fields, "p95UpperMs"]}
              labels={{ time: "Time", p95UpperMs: "p95 upper (ms)" }}
              records={{ items: rows.slice((page - 1) * 25, page * 25), total: rows.length }}
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
