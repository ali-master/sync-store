import { ArrowRight, Database, HardDrive, KeyRound, Network, type LucideIcon } from "lucide-react";
import { BarChart } from "@/components/charts/bar-chart";
import {
  DonutChart,
  DonutChartCenter,
  DonutChartLegend,
  DonutChartPlot,
} from "@/components/charts/donut-chart";
import { useSectionNavigate } from "@/components/console-nav";
import type { DataScope } from "@/components/data-scope";
import { AnimatedBadge } from "@/components/motion/animated-badge";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { Button } from "@/components/motion/button/base";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/motion/card";
import { formatBytes, formatDuration, type Row } from "@/lib/console";

const whole = (value: number) => Math.round(value).toLocaleString();

/** The collections an operator reasons about together, in a fixed colour order. */
const collections: [id: string, name: string, color: string][] = [
  ["storage", "Stored items", "var(--chart-1)"],
  ["history", "Retained versions", "var(--chart-2)"],
  ["audits", "Activity entries", "var(--chart-3)"],
  ["conflicts", "Conflicts", "var(--chart-4)"],
  ["analytics", "Analytics records", "var(--chart-5)"],
];

function Stat({
  label,
  help,
  icon: Icon,
  children,
}: {
  label: string;
  help: string;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <Card size="compact">
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
          {label}
          <span className="grid size-7 place-items-center rounded-lg bg-accent text-accent-foreground">
            <Icon className="size-3.5" aria-hidden="true" />
          </span>
        </div>
        <p className="text-3xl font-semibold tracking-tight tabular-nums">{children}</p>
        <p className="text-xs text-muted-foreground">{help}</p>
      </CardContent>
    </Card>
  );
}

/** Summarize the installation and point to the most common next tasks. */
export function Overview({ overview, dataScope }: { overview: Row; dataScope: DataScope }) {
  const go = useSectionNavigate(dataScope);
  const counts: Record<string, number> = overview.counts ?? {};
  const segments = collections
    .map(([id, name, color]) => ({ id, name, color, value: counts[id] ?? 0 }))
    .filter((segment) => segment.value > 0);
  const access = ["keys", "projects", "tenants", "sessions", "quotas"].filter(
    (id) => typeof counts[id] === "number",
  );

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Stored items" help={`Across ${whole(overview.users)} users`} icon={Database}>
          <AnimatedNumber value={counts.storage ?? 0} format={whole} />
        </Stat>
        <Stat label="Live connections" help="Sockets across connected replicas" icon={Network}>
          <AnimatedNumber value={overview.activeSessions} format={whole} />
        </Stat>
        <Stat label="API keys" help="Application and administrator credentials" icon={KeyRound}>
          <AnimatedNumber value={counts.keys ?? 0} format={whole} />
        </Stat>
        <Stat label="Storage used" help="Persisted item sizes" icon={HardDrive}>
          {formatBytes(overview.storageBytes)}
        </Stat>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle as="h2">Records by collection</CardTitle>
            <CardDescription>Counted in your database just now. Not a history.</CardDescription>
          </CardHeader>
          <CardContent>
            {segments.length ? (
              <DonutChart
                segments={segments}
                formatValue={whole}
                label="Records by collection"
                onSelect={go}
              >
                <div className="grid items-center gap-6 md:grid-cols-[11rem_1fr]">
                  <DonutChartPlot className="mx-auto w-44">
                    <DonutChartCenter totalLabel="records" />
                  </DonutChartPlot>
                  <DonutChartLegend />
                </div>
              </DonutChart>
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Nothing is stored yet. Connect your app to write the first item.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">Backend</CardTitle>
            <CardDescription>
              MongoDB answered a ping in{" "}
              <b className="font-medium text-foreground">{overview.databaseLatencyMs} ms</b>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <AnimatedBadge status="success" pulse>
              Responding
            </AnimatedBadge>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm [&_dd]:mt-1 [&_dd]:font-medium [&_dt]:text-xs [&_dt]:text-muted-foreground">
              <div>
                <dt>Runtime</dt>
                <dd>{overview.runtime}</dd>
              </div>
              <div>
                <dt>Database</dt>
                <dd className="truncate font-mono text-xs">{overview.database}</dd>
              </div>
              <div>
                <dt>Process uptime</dt>
                <dd>{formatDuration(overview.uptimeSeconds)}</dd>
              </div>
              <div>
                <dt>Lifetime key requests</dt>
                <dd className="tabular-nums">{whole(overview.totalCalls)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle as="h2">Access and connections</CardTitle>
            <CardDescription>Credentials, workspaces and live sessions.</CardDescription>
          </CardHeader>
          <CardContent>
            <BarChart
              orientation="horizontal"
              categories={access.map((id) => id[0].toUpperCase() + id.slice(1))}
              series={[
                {
                  id: "count",
                  name: "Records",
                  color: "var(--chart-2)",
                  values: access.map((id) => counts[id]),
                },
              ]}
              formatValue={whole}
              label="Access and connection records"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">Next steps</CardTitle>
            <CardDescription>The places operators go most.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {(
              [
                ["storage", "Explore stored data"],
                ["keys", "Manage application access"],
                ["health", "Check sync health"],
                ["conflicts", "Review conflicts"],
              ] as const
            ).map(([id, label]) => (
              <Button
                key={id}
                variant="outline"
                className="w-full justify-between"
                onClick={() => go(id)}
              >
                {label}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
