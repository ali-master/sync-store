import { Card } from "@/components/ui/card";
import { display, type Row } from "@/lib/console";

/** Show installation details and the operational boundaries of this console. */
export function System({ overview }: { overview: Row }) {
  return (
    <section className="grid gap-5 xl:grid-cols-2">
      <Card className="gap-5 p-6 [&_h2]:font-semibold [&_p]:text-sm [&_p]:leading-7 [&_p]:text-muted-foreground [&_dl>div]:flex [&_dl>div]:flex-wrap [&_dl>div]:justify-between [&_dl>div]:gap-3 [&_dl>div]:border-b [&_dl>div]:py-4 [&_dl]:text-xs [&_dt]:text-muted-foreground">
        <h2>Installation details</h2>
        <dl>
          {Object.entries({
            Database: overview.database,
            Runtime: overview.runtime,
            "API origin": location.origin,
            "Database latency": overview.databaseLatencyMs + " ms",
            "Process uptime": overview.uptimeSeconds + " seconds",
            "Last refresh": display(overview.timestamp),
          }).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card className="gap-5 p-6 [&_h2]:font-semibold [&_p]:text-sm [&_p]:leading-7 [&_p]:text-muted-foreground [&_dl>div]:flex [&_dl>div]:flex-wrap [&_dl>div]:justify-between [&_dl>div]:gap-3 [&_dl>div]:border-b [&_dl>div]:py-4 [&_dl]:text-xs [&_dt]:text-muted-foreground">
        <h2>Operational boundaries</h2>
        <p>
          Multiple API replicas require shared Redis. Writes are at least once. Prisma 8 MongoDB
          support is early access.
        </p>
        <p>
          API keys authorize applications, not user identities. Authenticate users in your trusted
          backend.
        </p>
        <p>
          Archives and historical analytics are inspectable records. Unsupported automation and
          inferred metrics are not shown as active services.
        </p>
        <p>
          Environment settings are controlled by your deployment. This console does not modify
          server secrets or restart services.
        </p>
      </Card>
    </section>
  );
}
