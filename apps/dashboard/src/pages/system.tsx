import { Card, CardContent, CardHeader, CardTitle } from "@/components/motion/card";
import { display, type Row } from "@/lib/console";

/** Show installation details and the operational boundaries of this console. */
export function System({ overview }: { overview: Row }) {
  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle as="h2">Installation details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y">
            {Object.entries({
              Database: overview.database,
              Runtime: overview.runtime,
              "API origin": location.origin,
              "Database latency": overview.databaseLatencyMs + " ms",
              "Process uptime": overview.uptimeSeconds + " seconds",
              "Last refresh": display(overview.timestamp),
            }).map(([key, value]) => (
              <div
                key={key}
                className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3 first:pt-0 last:pb-0"
              >
                <dt className="text-muted-foreground">{key}</dt>
                <dd className="min-w-0 break-all font-medium tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle as="h2">Operational boundaries</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y leading-6 text-muted-foreground [&>li]:py-3 [&>li:first-child]:pt-0 [&>li:last-child]:pb-0">
            <li>
              Multiple API replicas require shared Redis. Writes are at least once. Prisma 8 MongoDB
              support is early access.
            </li>
            <li>
              API keys authorize applications, not user identities. Authenticate users in your
              trusted backend.
            </li>
            <li>
              Archives and historical analytics are inspectable records. Unsupported automation and
              inferred metrics are not shown as active services.
            </li>
            <li>
              Environment settings are controlled by your deployment. This console does not modify
              server secrets or restart services.
            </li>
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}
