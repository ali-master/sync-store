import { useEffect, useRef, useState } from "react";
import { Check, CheckCheck, Code2, Copy, KeyRound, Radio, ArrowUpRight } from "lucide-react";
import { RemoteStorage } from "@usex/sync-client";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card } from "./ui/card";

/** Verify a real two-client exchange, then remove only the probe created by this run. */
export function ConnectApp() {
  const [framework, setFramework] = useState("JavaScript");
  const [copied, setCopied] = useState(false);
  const [phase, setPhase] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [proof, setProof] = useState("");
  const clients = useRef<RemoteStorage[]>([]);
  const cancelled = useRef(false);
  useEffect(
    () => () => {
      cancelled.current = true;
      clients.current.forEach((client) => client.destroy());
    },
    [],
  );
  const code =
    framework === "React"
      ? `import { SyncProvider, useSyncClient, useSyncValue, useSyncStatus } from "@usex/sync-client/react";

function Preferences() {
  const store = useSyncClient();
  const [theme, setTheme] = useSyncValue(store, "theme", "light");
  const status = useSyncStatus();
  return <button onClick={() => void setTheme("dark").catch(console.error)}>
    {theme} · {status.state}
  </button>;
}

// Connect once using the JavaScript example, then share storage.
<SyncProvider client={storage}><Preferences /></SyncProvider>`
      : `import { connectBrowser } from "@usex/sync-client";

const { storage, expiresAt } = await connectBrowser({
  serverUrl: ${JSON.stringify(location.origin)},
  session: async () => {
    // Your application's authenticated server endpoint.
    const response = await fetch("/my-app/sync-session", { cache: "no-store" });
    if (!response.ok) throw new Error("Sign in to connect");
    return response.json();
  },
});

await storage.setItem("theme", "dark");
await storage.flush(); // Server acknowledged the writes.
console.log(storage.getStatus());
// Renew explicitly before expiresAt; close on logout.
// await storage.close({ flush: true });`;

  async function test(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const apiKey = String(data.get("key")).trim();
    const userId = String(data.get("user")).trim();
    const branch = String(data.get("branch") || "main");
    setBusy(true);
    setError("");
    setProof("");
    setPhase(0);
    cancelled.current = false;
    const runId = crypto.randomUUID();
    const probe = `__sync_check__/${runId}`;
    let writer: RemoteStorage | undefined;
    let wrote = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await fetch("/api/v1/client-sessions", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "x-user-id": userId,
          "x-instance-id": runId,
          "x-branch": branch,
        },
        signal: AbortSignal.timeout(15000),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Session could not be created");
      const session = body.payload;
      if (cancelled.current) return;
      setPhase(1);
      const pair = ["writer", "receiver"].map(
        (role) =>
          new RemoteStorage({
            serverUrl: location.origin,
            apiKey: session.token,
            userId,
            branch,
            mode: "websocket",
            namespace: `connection-check:${runId}:${role}`,
            autoConnect: false,
          }),
      );
      clients.current = pair;
      [writer] = pair;
      const receiver = pair[1];
      await Promise.all(pair.map((client) => client.ready()));
      await receiver.subscribe([probe]);
      setPhase(2);
      const received = new Promise<void>((resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("No remote event received within 10 seconds")),
          10000,
        );
        receiver.on("change", (change) => {
          if (
            change.key === probe &&
            change.source === "remote" &&
            (change.newValue as any)?.runId === runId
          )
            resolve();
        });
      });
      // Attach a rejection handler while the writer is still awaiting its acknowledgement.
      void received.catch(() => {});
      wrote = true;
      await writer.setItem(probe, { runId });
      setPhase(3);
      await received;
      setPhase(4);
      await writer.removeItem(probe);
      wrote = false;
      if (!cancelled.current)
        setProof(
          "Verified: a separate client received the server event. The temporary value was removed; its history and audit records remain.",
        );
    } catch (error) {
      if (!cancelled.current)
        setError(error instanceof Error ? error.message : "Connection check failed");
    } finally {
      if (timeout) clearTimeout(timeout);
      if (wrote && writer) {
        try {
          await writer.removeItem(probe);
        } catch {
          if (!cancelled.current)
            setError(
              (message) =>
                `${message} Cleanup could not be confirmed. Inspect ${probe} for user ${userId}.`,
            );
        }
      }
      clients.current.forEach((client) => client.destroy());
      clients.current = [];
      const keyInput = form.elements.namedItem("key") as HTMLInputElement;
      if (keyInput) keyInput.value = "";
      if (!cancelled.current) setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-5">
        <Card className="gap-0 overflow-hidden">
          <div className="border-b p-5">
            <p className="text-xs font-medium text-primary">01 · CONNECT</p>
            <h2 className="mt-2 text-lg font-semibold">
              A small client. A shared source of truth.
            </h2>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">
              Create an application key, keep it in your backend, and issue a short-lived session
              for each signed-in user.
            </p>
          </div>
          <div className="flex items-center justify-between border-b px-4">
            <div className="flex gap-1" role="tablist" aria-label="SDK example">
              {["JavaScript", "React"].map((name) => (
                <button
                  key={name}
                  role="tab"
                  aria-selected={framework === name}
                  onClick={() => {
                    setFramework(name);
                    setCopied(false);
                  }}
                  className={
                    "border-b-2 px-4 py-3 text-xs " +
                    (framework === name
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground")
                  }
                >
                  {name}
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void navigator.clipboard.writeText(code).then(
                  () => setCopied(true),
                  () => setError("Clipboard unavailable. Select the code to copy it."),
                )
              }
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <pre className="overflow-x-auto bg-muted/25 p-5 text-[11px] leading-6" role="tabpanel">
            <code>{code}</code>
          </pre>
        </Card>
        <Card className="p-5 sm:p-6">
          <p className="text-xs font-medium text-primary">02 · VERIFY</p>
          <h2 className="text-lg font-semibold">See a change arrive.</h2>
          <p className="text-xs leading-6 text-muted-foreground">
            Use a test application key with read/write access to <code>__sync_check__/</code>. This
            creates and removes one temporary value in the selected user's branch. History and audit
            records are retained.
          </p>
          <form onSubmit={(event) => void test(event)} className="grid gap-4 sm:grid-cols-2">
            <Label className="grid gap-2 sm:col-span-2">
              Test application key
              <Input
                name="key"
                type="password"
                required
                autoComplete="off"
                placeholder="ss_…"
                disabled={busy}
              />
            </Label>
            <Label className="grid gap-2">
              Test user
              <Input name="user" required defaultValue="connection-check" disabled={busy} />
            </Label>
            <Label className="grid gap-2">
              Branch
              <Input name="branch" required defaultValue="main" disabled={busy} />
            </Label>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <Button type="submit" disabled={busy}>
                <Radio className="size-4" />
                {busy ? "Checking delivery…" : "Run connection check"}
              </Button>
              <span className="text-[11px] text-muted-foreground">
                Credentials stay in memory and are cleared after the check.
              </span>
            </div>
          </form>
          {error && (
            <p
              role="alert"
              className="break-words rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs leading-6 text-destructive"
            >
              {error}
            </p>
          )}
          {proof && (
            <p
              role="status"
              className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs leading-6 text-emerald-800"
            >
              {proof}
            </p>
          )}
        </Card>
      </div>
      <aside className="space-y-5">
        <Card className="gap-0 p-5">
          <h2 className="mb-5 text-xs font-semibold">Connection checklist</h2>
          {[
            "Session issued",
            "Two clients connected",
            "Write acknowledged",
            "Remote event received",
          ].map((step, index) => (
            <div key={step} className="flex items-center gap-3 border-b py-4 text-xs last:border-0">
              <span
                className={
                  "grid size-6 shrink-0 place-items-center rounded-full border " +
                  (phase > index
                    ? "border-primary/20 bg-primary/5 text-primary"
                    : "text-muted-foreground")
                }
              >
                {phase > index ? <Check className="size-3.5" /> : index + 1}
              </span>
              {step}
            </div>
          ))}
        </Card>
        <div className="space-y-4 px-2 text-xs leading-6 text-muted-foreground">
          <div className="flex gap-3">
            <KeyRound className="mt-1 size-4 shrink-0 text-primary" />
            <p>
              Keep application keys on your server. Browser sessions are bound to one user and
              branch.
            </p>
          </div>
          <div className="flex gap-3">
            <CheckCheck className="mt-1 size-4 shrink-0 text-primary" />
            <p>
              A socket connection is not proof of delivery. This check waits for a real event on the
              receiving client.
            </p>
          </div>
          <a
            href="/api/docs"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-primary"
          >
            <Code2 className="size-4" />
            Explore the API
            <ArrowUpRight className="size-3" />
          </a>
        </div>
      </aside>
    </div>
  );
}
