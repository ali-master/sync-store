import { useNavigate } from "@tanstack/react-router";
import type { DataScope } from "@/components/data-scope";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Row } from "@/lib/console";

/** Summarize the installation and point to the most common next tasks. */
export function Overview({ overview, dataScope }: { overview: Row; dataScope: DataScope }) {
  const routerNavigate = useNavigate();
  function navigate(next: string) {
    void routerNavigate({
      to: next === "overview" ? "/" : "/" + next,
      search: { ...dataScope, page: 1, q: "" },
    });
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Stored items", overview.counts.storage, "Across " + overview.users + " users", "▤"],
          ["Live connections", overview.activeSessions, "Sockets across connected replicas", "⇄"],
          ["API keys", overview.counts.keys, "Application & admin credentials", "⌘"],
          [
            "Storage used",
            (overview.storageBytes / 1024).toFixed(1) + " KB",
            "Persisted item sizes",
            "◴",
          ],
        ].map(([label, value, help, icon]) => (
          <Card
            className="gap-5 p-6 [&>div]:flex [&>div]:items-center [&>div]:justify-between [&>div]:text-xs [&>div]:text-muted-foreground [&_strong]:text-4xl [&_strong]:font-medium [&_strong]:tracking-tight [&_small]:text-xs [&_small]:text-muted-foreground"
            key={String(label)}
          >
            <div>
              <span>{label}</span>
              <i aria-hidden="true">{icon}</i>
            </div>
            <strong>{value}</strong>
            <small>{help}</small>
          </Card>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <section className="rounded-xl border bg-gradient-to-br from-card to-primary/5 p-6">
          <p className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground">
            CONNECTION HEALTH
          </p>
          <div className="my-8 flex items-center gap-5 [&_h2]:text-lg [&_h2]:font-medium [&_p]:mt-2 [&_p]:text-sm [&_p]:text-muted-foreground">
            <span className="grid size-14 shrink-0 place-items-center rounded-full border-8 border-primary/5 bg-card text-xl text-primary">
              ↔
            </span>
            <div>
              <h2>Your backend is responding.</h2>
              <p>
                MongoDB ping completed in <b>{overview.databaseLatencyMs} ms</b>.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 border-t pt-5 [&_small]:block [&_small]:text-[10px] [&_small]:text-muted-foreground [&_b]:mt-2 [&_b]:block [&_b]:text-xs [&_b]:font-medium">
            <div>
              <small>Runtime</small>
              <b>{overview.runtime}</b>
            </div>
            <div>
              <small>Process uptime</small>
              <b>{Math.floor(overview.uptimeSeconds / 60)} min</b>
            </div>
            <div>
              <small>Lifetime key requests</small>
              <b>{overview.totalCalls.toLocaleString()}</b>
            </div>
          </div>
        </section>
        <section className="space-y-4 rounded-xl border bg-card p-6 [&_h2]:text-lg [&_h2]:font-medium [&_button]:w-full [&_button]:justify-between">
          <p className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground">
            NEXT STEPS
          </p>
          <h2>A place for every detail.</h2>
          <Button variant="outline" onClick={() => navigate("storage")}>
            Explore stored data <span>→</span>
          </Button>
          <Button variant="outline" onClick={() => navigate("keys")}>
            Manage application access <span>→</span>
          </Button>
          <Button variant="outline" onClick={() => navigate("conflicts")}>
            Review conflicts <span>→</span>
          </Button>
        </section>
      </div>
    </>
  );
}
