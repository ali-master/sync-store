import { useEffect, useRef, useState } from "react";
import { Check, CheckCheck, Code2, Copy, KeyRound, Radio, ArrowUpRight } from "lucide-react";
import { SyncStore } from "@usex/sync-store";
import { Alert, AlertContent, AlertIcon, AlertTitle } from "./motion/alert";
import { AnimatedBadge } from "./motion/animated-badge";
import { Button } from "./motion/button/base";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./motion/card";
import { Input } from "./motion/input";
import { Loader } from "./motion/loader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./motion/tabs";

const checklist = [
  "Session issued",
  "Two clients connected",
  "Write acknowledged",
  "Remote event received",
];
const inlineCode = "rounded bg-muted px-1 font-mono text-xs";

/** Verify a real two-client exchange, then remove only the probe created by this run. */
export function ConnectApp() {
  const [framework, setFramework] = useState("JavaScript");
  const [copied, setCopied] = useState(false);
  // Held in state so clearing it after the check also clears what the field shows.
  const [testKey, setTestKey] = useState("");
  const [phase, setPhase] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [proof, setProof] = useState("");
  const clients = useRef<SyncStore[]>([]);
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
      ? `import { SyncProvider, useSyncClient, useSyncValue, useSyncStatus } from "@usex/sync-store/react";

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
      : `import { SyncStore } from "@usex/sync-store";

const { storage, expiresAt } = await SyncStore.connect({
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
    let writer: SyncStore | undefined;
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
          new SyncStore({
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
      setTestKey("");
      if (!cancelled.current) setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="grid min-w-0 content-start gap-4">
        <Card className="overflow-hidden pb-0">
          <CardHeader>
            <p className="text-xs font-medium text-primary">01 · CONNECT</p>
            <CardTitle as="h2">Connect your application</CardTitle>
            <CardDescription>
              Create an application key, keep it in your backend, and issue a short-lived session
              for each signed-in user.
            </CardDescription>
          </CardHeader>
          <Tabs
            variant="segment"
            value={framework}
            onValueChange={(name) => {
              setFramework(name);
              setCopied(false);
            }}
            className="border-t"
          >
            <div className="flex items-center justify-between gap-3 border-b px-4 py-2">
              <TabsList aria-label="SDK example" wrapperClassName="w-auto" className="bg-muted">
                {["JavaScript", "React"].map((name) => (
                  <TabsTrigger key={name} value={name}>
                    {name}
                  </TabsTrigger>
                ))}
              </TabsList>
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
            <TabsContent value={framework} className="mt-0 rounded-none">
              <pre className="overflow-x-auto bg-muted/40 p-5 font-mono text-xs leading-6">
                <code>{code}</code>
              </pre>
            </TabsContent>
          </Tabs>
        </Card>
        <Card>
          <CardHeader>
            <p className="text-xs font-medium text-primary">02 · VERIFY</p>
            <CardTitle as="h2">See a change arrive.</CardTitle>
            <CardDescription>
              Use a test application key with read/write access to{" "}
              <code className={inlineCode}>__sync_check__/</code>. This creates and removes one
              temporary value in the selected user's branch. History and audit records are retained.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={(event) => void test(event)} className="grid gap-4 sm:grid-cols-2">
              <Input
                className="sm:col-span-2"
                label="Test application key"
                name="key"
                type="password"
                required
                autoComplete="off"
                placeholder="ss_…"
                disabled={busy}
                value={testKey}
                onChange={setTestKey}
                leftIcon={<KeyRound />}
              />
              <Input
                label="Test user"
                name="user"
                required
                defaultValue="connection-check"
                disabled={busy}
              />
              <Input label="Branch" name="branch" required defaultValue="main" disabled={busy} />
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <Button type="submit" disabled={busy}>
                  {busy ? (
                    <span aria-hidden="true" className="inline-flex">
                      <Loader size={16} className="text-current" />
                    </span>
                  ) : (
                    <Radio className="size-4" aria-hidden="true" />
                  )}
                  {busy ? "Checking delivery…" : "Run connection check"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  Credentials stay in memory and are cleared after the check.
                </span>
              </div>
            </form>
            {error && (
              <Alert variant="destructive">
                <AlertIcon />
                <AlertContent>
                  <AlertTitle className="break-words">{error}</AlertTitle>
                </AlertContent>
              </Alert>
            )}
            {proof && (
              <Alert variant="success">
                <AlertIcon />
                <AlertContent>
                  <AlertTitle>{proof}</AlertTitle>
                </AlertContent>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
      <aside className="connection-canvas grid content-start gap-4 rounded-2xl border p-4">
        <Card className="bg-card">
          <CardHeader>
            <CardTitle as="h2">Connection checklist</CardTitle>
            <CardAction>
              <AnimatedBadge
                size="sm"
                status={busy ? "loading" : proof ? "success" : "neutral"}
                showIcon={busy || Boolean(proof)}
              >
                {Math.min(phase, checklist.length)} of {checklist.length}
              </AnimatedBadge>
            </CardAction>
          </CardHeader>
          <CardContent>
            <ol className="divide-y">
              {checklist.map((step, index) => (
                <li key={step} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <span
                    className={
                      "grid size-6 shrink-0 place-items-center rounded-full border text-xs " +
                      (phase > index
                        ? "border-primary bg-primary text-primary-foreground"
                        : "text-muted-foreground")
                    }
                  >
                    {phase > index ? <Check className="size-3.5" aria-hidden="true" /> : index + 1}
                  </span>
                  <span className="flex-1">{step}</span>
                  {busy && phase === index && <Loader size={14} label={"Waiting: " + step} />}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        <Card className="bg-card">
          <CardContent className="space-y-4 text-xs leading-6 text-muted-foreground">
            <div className="flex gap-3">
              <KeyRound className="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />
              <p>
                Keep application keys on your server. Browser sessions are bound to one user and
                branch.
              </p>
            </div>
            <div className="flex gap-3">
              <CheckCheck className="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />
              <p>
                A socket connection is not proof of delivery. This check waits for a real event on
                the receiving client.
              </p>
            </div>
            <a
              href="/api/docs"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 font-medium text-primary hover:underline"
            >
              <Code2 className="size-4" aria-hidden="true" />
              Explore the API
              <ArrowUpRight className="size-3" aria-hidden="true" />
            </a>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
