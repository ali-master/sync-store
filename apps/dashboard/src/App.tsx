import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch, Link } from "@tanstack/react-router";
import { useSession } from "./lib/session";
import { RecordsTable } from "./components/records-table";
import { Versioning } from "./components/versioning";
import { Reports } from "./components/reports";
import { KeyPolicyFields } from "./components/key-policy-fields";
import { readKeyPolicy } from "./lib/key-policy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import logo from "../../../assets/logo.svg";

type Row = Record<string, any>;
type Page = { items: Row[]; total: number; page: number; pageSize: number };
const sections = [
  ["health", "Sync health", "◉"],
  ["usage", "Usage & quotas", "◴"],
  ["changes", "Changes & growth", "↗"],
  ["overview", "Overview", "◈"],
  ["storage", "Data explorer", "▤"],
  ["keys", "API keys", "⌘"],
  ["tenants", "Tenants", "◎"],
  ["versioning", "Branches & commits", "⑂"],
  ["projects", "Projects", "◫"],
  ["history", "Version history", "↶"],
  ["sessions", "Connections", "⇄"],
  ["conflicts", "Conflicts", "⑂"],
  ["quotas", "User quotas", "◴"],
  ["audits", "Activity log", "≋"],
  ["analytics", "Analytics records", "▥"],
  ["archives", "Archives", "▣"],
  ["system", "System", "⚙"],
];
const descriptions: Record<string, string> = {
  tenants:
    "Separate customer workspaces, each with its own administrator, projects, data and reports.",
  versioning: "Branch your data, inspect immutable commits and restore a complete snapshot safely.",
  changes:
    "Track data changes, retained history and storage growth. Save report views and export CSV.",
  usage: "Request trends, top consumers and live quota forecasts for each project and API key.",
  health: "Publication latency, pending events and connection trends across your replicas.",
  history:
    "Review retained versions and recover deleted data. Every restore creates a new synchronized change.",
  projects:
    "Isolated application namespaces. Bind API keys to a project to keep its data separate.",
  overview: "Your installation, at a glance. Real data from your connected backend.",
  storage: "Inspect and edit JSON across users. Changes use the live synchronization pipeline.",
  keys: "Issue application credentials and control their access. Secrets are shown only on creation or rotation.",
  sessions:
    "Inspect live Socket.IO connections across replicas and disconnect sessions. Clients may reconnect.",
  conflicts:
    "Review competing values and record a resolution proposal. Applying the value is a separate storage write.",
  quotas:
    "Stored per-user quota configuration. Enforcement depends on the backend path; these are not all active limits.",
  audits: "Recorded storage and administrator actions. This is not a complete HTTP request log.",
  analytics: "Persisted analytics records. No generated traffic or estimated historical metrics.",
  archives:
    "Inspect archived records. Archive restore and retention automation are not implemented.",
  system: "Connection health, runtime information and current operational boundaries.",
};
const columns: Record<string, string[]> = {
  tenants: ["name", "_id", "isActive", "createdAt"],
  history: ["key", "userId", "version", "isDeleted", "lastModified", "expiresAt"],
  projects: ["name", "_id", "createdAt"],
  storage: ["key", "userId", "version", "size", "lastModified"],
  keys: ["name", "isActive", "canWrite", "totalCalls", "lastUsedAt"],
  sessions: ["userId", "instanceId", "connectionType", "connectedAt", "disconnectedAt"],
  conflicts: ["userId", "conflictType", "status", "resolutionStrategy", "createdAt"],
  quotas: ["userId", "currentItems", "maxItems", "currentStorageBytes", "maxStorageBytes"],
  audits: ["action", "userId", "instanceId", "createdAt"],
  analytics: ["userId", "metricType", "period", "createdAt"],
  archives: ["key", "userId", "originalSize", "archivedAt"],
};
const labels: Record<string, string> = {
  key: "Storage key",
  userId: "User",
  instanceId: "Instance",
  isActive: "Active",
  canWrite: "Write",
  totalCalls: "Requests",
  lastUsedAt: "Last used",
  lastModified: "Modified",
  connectedAt: "Connected",
  disconnectedAt: "Disconnected",
  currentStorageBytes: "Used bytes",
  maxStorageBytes: "Storage limit",
  createdAt: "Created",
  _id: "Record ID",
};
const quotaFields = [
  "maxStorageBytes",
  "maxItems",
  "requestsPerMinute",
  "requestsPerHour",
  "requestsPerDay",
  "maxInstancesPerUser",
  "maxConflictsPerHour",
  "maxAuditRetentionDays",
];
const policyFields = [
  "minuteQuota",
  "hourQuota",
  "dailyQuota",
  "monthlyQuota",
  "ipRestrictions",
  "websiteOrigins",
  "restrictionMode",
  "allowedMethods",
  "allowedUserAgents",
  "blockedUserAgents",
  "requireHttps",
  "expiresAt",
];
const bootstrapId = "sync-store-bootstrap-admin";

/** Show structured values without losing false, zero or large integer strings. */
function display(value: any): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value))
    return new Date(value).toLocaleString();
  return String(value);
}

/** Manage a single installation with a memory-only administrator credential. */
export default function App({ section }: { section: string }) {
  const { token, setToken, sessionId, logout: endSession } = useSession();
  const queryClient = useQueryClient();
  const routerNavigate = useNavigate();
  const { page, q: query } = useSearch({ strict: false }) as { page: number; q: string };
  const [credential, setCredential] = useState("");
  const [search, setSearch] = useState(query);
  const [actionError, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const [historyPreview, setHistoryPreview] = useState<Row | null>(null);
  const [editor, setEditor] = useState("");
  const [user, setUser] = useState("");
  const [storageKey, setStorageKey] = useState("");
  const [name, setName] = useState("");
  const [canWrite, setCanWrite] = useState(false);
  const [canRead, setCanRead] = useState(true);
  const [secret, setSecret] = useState("");
  const [strategy, setStrategy] = useState("last_write_wins");
  const [mobileMenu, setMobileMenu] = useState(false);
  const instance = useRef(crypto.randomUUID());
  const [confirm, setConfirm] = useState<{ text: string; run: () => Promise<void> } | null>(null);
  useEffect(() => {
    setSearch(query);
    setSelected(null);
    setSecret("");
    setConfirm(null);
  }, [query, page]);

  /** Call only this dashboard's API origin; never persist credentials in web storage. */
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    key = token,
    signal?: AbortSignal,
  ) {
    const response = await fetch("/api/v1/admin/" + path, {
      method,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
      cache: "no-store",
      headers: {
        Authorization: "Bearer " + key,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        "x-user-id": "dashboard",
        "x-instance-id": instance.current,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        typeof data.message === "string"
          ? data.message
          : "Request failed (" + response.status + ")",
      );
    return data.payload;
  }

  const resource = ["overview", "system"].includes(section) ? "audits" : section;
  const overviewQuery = useQuery<Row>({
    queryKey: ["console", sessionId, "overview"],
    queryFn: ({ signal }) => request("overview", "GET", undefined, token, signal),
    enabled: Boolean(token),
  });
  const recordsQuery = useQuery<Page>({
    queryKey: ["console", sessionId, "records", resource, page, query],
    queryFn: ({ signal }) =>
      request(
        "resources/" + resource + "?page=" + page + "&q=" + encodeURIComponent(query),
        "GET",
        undefined,
        token,
        signal,
      ),
    enabled:
      Boolean(token) && !["system", "health", "usage", "changes", "versioning"].includes(section),
  });
  const mutation = useMutation({
    mutationFn: (action: () => Promise<void>) => action(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["console", sessionId] }),
  });
  const overview = overviewQuery.data;
  const projectsQuery = useQuery<Page>({
    queryKey: ["console", sessionId, "projects"],
    queryFn: async () => {
      const first: Page = await request("resources/projects");
      const items = [...first.items];
      for (let page = 2; items.length < first.total; page++) {
        const next: Page = await request("resources/projects?page=" + page);
        if (!next.items.length) break;
        items.push(...next.items);
      }
      return { ...first, items };
    },
    enabled: Boolean(token) && section === "keys",
  });
  const records = recordsQuery.data;
  const loading = overviewQuery.isFetching || recordsQuery.isFetching;
  const busy = mutation.isPending;
  const error = actionError || overviewQuery.error?.message || recordsQuery.error?.message || "";
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["console", sessionId] });
  };

  /** Mutations are never retried automatically; keep failed drafts available for correction. */
  async function run(action: () => Promise<void>) {
    setError("");
    setNotice("");
    try {
      await mutation.mutateAsync(action);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Operation failed");
    } finally {
      mutation.reset();
    }
  }

  function navigate(next: string) {
    void routerNavigate({ to: next === "overview" ? "/" : "/" + next, search: { page: 1, q: "" } });
  }
  function setPage(next: number) {
    void routerNavigate({
      to: section === "overview" ? "/" : "/" + section,
      search: { page: next, q: query },
    });
  }

  /** Populate an inspector from the selected backend record. */
  function inspect(row: Row) {
    setHistoryPreview(null);
    setSelected(row);
    setSecret("");
    setUser(row.userId || "");
    setStorageKey(row.key || "");
    setName(row.name || "");
    setCanWrite(row.canWrite ?? false);
    setCanRead(row.canRead ?? true);
    if (section === "storage") {
      try {
        setEditor(JSON.stringify(JSON.parse(row.value), null, 2));
      } catch {
        setEditor(row.value || "{}");
      }
    } else if (section === "keys")
      setEditor(
        JSON.stringify(
          Object.fromEntries(
            policyFields.map((field) => {
              let value =
                row[field] ??
                (field.endsWith("Quota") || field === "expiresAt"
                  ? null
                  : field === "requireHttps"
                    ? false
                    : field === "restrictionMode"
                      ? "allow"
                      : []);
              if (typeof value === "string" && value.startsWith("[")) {
                try {
                  value = JSON.parse(value);
                } catch {
                  /* Show invalid persisted configuration for correction. */
                }
              }
              return [field, value];
            }),
          ),
          null,
          2,
        ),
      );
    else if (section === "quotas")
      setEditor(JSON.stringify(Object.fromEntries(quotaFields.map((f) => [f, row[f]])), null, 2));
    else setEditor(JSON.stringify(row, null, 2));
  }

  /** Create a draft only; the API is changed after the user submits the form. */
  function newRecord() {
    inspect({
      _new: true,
      value: "{}",
      name: "",
      canRead: true,
      canWrite: false,
      allowedMethods: '["GET","POST","PUT","PATCH","DELETE"]',
    });
  }

  /** End the local admin session and remove all rendered private records. */
  function logout() {
    endSession();
    setCredential("");
    setSelected(null);
    setSecret("");
    setError("");
    setConfirm(null);
  }

  if (!token)
    return (
      <main className="mx-auto grid min-h-screen max-w-6xl items-center gap-12 px-6 py-12 lg:grid-cols-[1.2fr_1fr] lg:gap-24">
        <div className="space-y-7 [&>img]:size-14 [&_h1]:text-5xl [&_h1]:font-semibold [&_h1]:leading-[1.12] [&_h1]:tracking-tight [&_h1_span]:text-muted-foreground [&>p:not(:first-of-type)]:max-w-md [&>p:not(:first-of-type)]:leading-7 [&>p:not(:first-of-type)]:text-muted-foreground">
          <img src={logo} alt="Sync Store" />
          <p className="text-[10px] font-semibold tracking-[0.24em] text-muted-foreground">
            SYNC STORE CONSOLE
          </p>
          <h1>
            Everything connected.
            <br />
            <span>Everything in view.</span>
          </h1>
          <p>A quiet place to manage your data, credentials and connections.</p>
          <div className="flex flex-wrap items-center gap-4 pt-7 text-xs [&_strong]:rounded-xl [&_strong]:border [&_strong]:bg-card [&_strong]:p-4 [&_i]:text-muted-foreground">
            <span>Application</span>
            <i>⇄</i>
            <strong>Sync Store</strong>
            <i>⇄</i>
            <span>Your users</span>
          </div>
        </div>
        <form
          className="space-y-6 rounded-2xl border bg-card p-7 shadow-sm sm:p-9 [&_h2]:text-3xl [&_h2]:font-semibold [&_h2]:tracking-tight [&>p]:text-sm [&>p]:leading-6 [&>p]:text-muted-foreground [&_label]:flex-col [&_label]:items-start [&_label]:gap-2 [&>button]:w-full [&>a]:block [&>a]:text-center [&>a]:text-xs [&>a]:text-primary"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await request("overview", "GET", undefined, credential.trim());
              setToken(credential.trim());
              setCredential("");
            });
          }}
        >
          <span className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground">
            YOUR INSTALLATION
          </span>
          <h2>Welcome back.</h2>
          <p>Connect with the administrator key you saved during setup.</p>
          <Label>
            Administrator key
            <Input
              type="password"
              autoComplete="off"
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
              required
              placeholder="ss_admin_…"
            />
          </Label>
          <Button type="submit" variant="default" disabled={busy}>
            {busy ? "Connecting…" : "Open console →"}
          </Button>

          {error && (
            <p
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <div className="space-y-3 border-t pt-6 text-xs leading-6 text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1">
            <b>Need your administrator key?</b>
            <p>
              Recover it on your server with <code>docker compose exec api bun run admin:key</code>.
            </p>
            <p>Your key stays in this tab's memory. Refreshing signs you out.</p>
          </div>
          <a href="/api/docs">API reference ↗</a>
        </form>
      </main>
    );

  const title = sections.find((s) => s[0] === section)![1];
  const activeColumns = columns[section] || columns.audits;
  const rootKey = selected?._id === bootstrapId;
  const mutationDone = (message: string) => {
    setSelected(null);
    setNotice(message);
    refresh();
  };

  const sidebarContent = (
    <>
      {" "}
      <a
        className="flex items-center gap-2 px-1 text-base font-semibold whitespace-nowrap tracking-tight [&_img]:size-7 [&_span]:ml-auto [&_span]:rounded [&_span]:border [&_span]:px-1.5 [&_span]:py-0.5 [&_span]:text-[9px] [&_span]:font-normal [&_span]:uppercase [&_span]:tracking-widest"
        href="#"
        onClick={(e) => {
          e.preventDefault();
          navigate("overview");
        }}
      >
        <img src={logo} alt="" />
        Sync Store<span>console</span>
      </a>
      <div className="my-8 flex items-center gap-3 rounded-xl border bg-muted/40 p-3 [&_b]:block [&_b]:text-xs [&_small]:mt-1 [&_small]:block [&_small]:max-w-36 [&_small]:truncate [&_small]:text-[10px] [&_small]:text-muted-foreground">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border bg-primary/5 text-sm text-primary">
          S
        </span>
        <div>
          <b>{overview?.tenantId ? "Tenant workspace" : "Your installation"}</b>
          <small>{overview?.database || "Connecting…"}</small>
        </div>
        <span className="inline-block size-1.5 shrink-0 rounded-full bg-emerald-500" />
      </div>
      <p className="mb-3 mt-6 px-3 text-[10px] font-semibold tracking-[0.2em] text-muted-foreground">
        WORKSPACE
      </p>
      <nav aria-label="Console navigation">
        {sections
          .filter(([id]) => id !== "tenants" || overview?.tenantId === null)
          .map(([id, label, icon], i) => (
            <div key={id}>
              {i === 6 && (
                <p className="mb-3 mt-6 px-3 text-[10px] font-semibold tracking-[0.2em] text-muted-foreground">
                  OBSERVABILITY
                </p>
              )}
              <Link
                to={id === "overview" ? "/" : "/" + id}
                search={{ page: 1, q: "" }}
                disabled={busy}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition hover:bg-muted aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary"
                aria-current={section === id ? "page" : undefined}
              >
                <span aria-hidden="true">{icon}</span>
                {label}
                {id === "conflicts" && overview && overview.counts.conflicts > 0 && (
                  <em>{overview.counts.conflicts}</em>
                )}
              </Link>
            </div>
          ))}
      </nav>
      <div className="mt-auto space-y-5 pt-12 text-xs [&>a]:text-muted-foreground [&>div]:flex [&>div]:items-center [&>div]:gap-3 [&>div]:border-t [&>div]:pt-5 [&_b]:block [&_small]:mt-1 [&_small]:block [&_small]:text-[10px] [&_small]:text-muted-foreground">
        <a href="/api/docs" target="_blank" rel="noreferrer">
          API reference ↗
        </a>
        <div>
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/5 text-[10px] text-primary">
            AD
          </span>
          <div>
            <b>{overview?.tenantId ? "Tenant administrator" : "Administrator"}</b>
            <small>{overview?.tenantId ? "Tenant access" : "Installation access"}</small>
          </div>
          <Button variant="outline" onClick={logout} disabled={busy} aria-label="Sign out">
            ↗
          </Button>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r bg-card p-5 lg:flex">
        {sidebarContent}
      </aside>
      <Sheet open={mobileMenu} onOpenChange={setMobileMenu}>
        <SheetContent side="left" className="w-72 gap-0 p-5" showCloseButton={false}>
          <SheetTitle className="sr-only">Console navigation</SheetTitle>
          <SheetDescription className="sr-only">Choose an installation view.</SheetDescription>
          {sidebarContent}
        </SheetContent>
      </Sheet>

      <div className="min-w-0 lg:ml-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b bg-background/90 px-5 backdrop-blur sm:px-8 [&>span]:text-xs [&>span]:text-muted-foreground [&_i]:mx-3 [&_i]:not-italic [&>div]:flex [&>div]:items-center [&>div]:gap-4">
          <Button
            variant="outline"
            className="lg:hidden"
            aria-label="Toggle navigation"
            aria-expanded={mobileMenu}
            onClick={() => setMobileMenu((v) => !v)}
          >
            ☰
          </Button>
          <span>
            Workspace <i>/</i> <b>{title}</b>
          </span>
          <div>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-block size-1.5 shrink-0 rounded-full bg-emerald-500" />
              Authenticated
            </span>
            <Button
              variant="outline"
              disabled={busy || loading}
              onClick={refresh}
              aria-label="Refresh data"
            >
              ↻
            </Button>
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] space-y-7 px-5 py-10 sm:px-8 lg:px-10">
          <div className="flex flex-wrap items-center justify-between gap-5 [&_h1]:mt-3 [&_h1]:text-4xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1_span]:text-primary [&_h1+p]:mt-3 [&_h1+p]:max-w-2xl [&_h1+p]:text-sm [&_h1+p]:leading-6 [&_h1+p]:text-muted-foreground">
            <div>
              <p className="text-[10px] font-semibold tracking-[0.24em] text-muted-foreground">
                SYNC STORE / {section === "overview" ? "CONTROL CENTER" : "WORKSPACE"}
              </p>
              <h1>
                {title}
                <span>.</span>
              </h1>
              <p>{descriptions[section]}</p>
            </div>
            {["storage", "keys"].includes(section) && (
              <Button variant="default" disabled={busy} onClick={newRecord}>
                ＋ {section === "keys" ? "Create API key" : "Add item"}
              </Button>
            )}
          </div>
          {(section === "projects" || (section === "tenants" && overview?.tenantId === null)) && (
            <form
              className="flex flex-wrap items-end gap-4 rounded-2xl border bg-card p-5"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = new FormData(form);
                void run(async () => {
                  const created = await request(section, "POST", { name: data.get("name") });
                  if (created.key) {
                    setSecret(created.key);
                    setSelected(created);
                  }
                  form.reset();
                  setNotice(
                    section === "tenants"
                      ? "Tenant created. Save its administrator key and use it to sign in to the tenant workspace."
                      : "Project created. Create an API key bound to this project.",
                  );
                });
              }}
            >
              <Label className="min-w-0 flex-1">
                {section === "tenants" ? "Tenant name" : "Project name"}
                <Input name="name" required maxLength={100} placeholder="Production workspace" />
              </Label>
              <Button type="submit" disabled={busy}>
                Create {section === "tenants" ? "tenant" : "project"}
              </Button>
            </form>
          )}
          {error && (
            <div
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"
              role="alert"
            >
              {error}
              <Button variant="outline" onClick={refresh}>
                Retry
              </Button>
            </div>
          )}
          {notice && (
            <div
              className="rounded-lg border border-primary/15 bg-primary/5 p-4 text-sm text-primary"
              role="status"
            >
              ✓ {notice}
            </div>
          )}
          {loading && (
            <p role="status" className="text-xs text-muted-foreground">
              Updating from your API…
            </p>
          )}
          {section === "overview" && overview && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  [
                    "Stored items",
                    overview.counts.storage,
                    "Across " + overview.users + " users",
                    "▤",
                  ],
                  [
                    "Live connections",
                    overview.activeSessions,
                    "Sockets across connected replicas",
                    "⇄",
                  ],
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
          )}
          {section === "versioning" ? (
            <Versioning request={request} sessionId={sessionId} tenantId={overview?.tenantId} />
          ) : ["health", "usage", "changes"].includes(section) ? (
            <Reports kind={section} request={request} sessionId={sessionId} />
          ) : section === "system" && overview ? (
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
                  Multiple API replicas require shared Redis. Writes are at least once. Prisma 8
                  MongoDB support is early access.
                </p>
                <p>
                  API keys authorize applications, not user identities. Authenticate users in your
                  trusted backend.
                </p>
                <p>
                  Archives and historical analytics are inspectable records. Unsupported automation
                  and inferred metrics are not shown as active services.
                </p>
                <p>
                  Environment settings are controlled by your deployment. This console does not
                  modify server secrets or restart services.
                </p>
              </Card>
            </section>
          ) : (
            <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-4 p-6 [&_h2]:font-semibold [&_span]:text-xs [&_span]:text-muted-foreground">
                <div>
                  <h2>{section === "overview" ? "Recent recorded activity" : title}</h2>
                  <span>
                    {records ? records.total.toLocaleString() + " records" : "Loading records"}
                  </span>
                </div>
                <form
                  className="flex w-full items-center gap-2 sm:w-80"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void routerNavigate({
                      to: section === "overview" ? "/" : "/" + section,
                      search: { page: 1, q: search },
                    });
                  }}
                >
                  <span aria-hidden="true">⌕</span>
                  <Input
                    aria-label="Search records"
                    placeholder="Search records…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <Button variant="outline" type="submit">
                    Search
                  </Button>
                </form>
              </div>
              <RecordsTable
                fields={activeColumns}
                labels={labels}
                records={records}
                page={page}
                loading={loading}
                query={query}
                onPageChange={setPage}
                onInspect={inspect}
                display={display}
              />
            </section>
          )}
          <footer className="flex flex-wrap items-center justify-between gap-3 text-[10px] text-muted-foreground [&>span]:flex [&>span]:items-center [&>span]:gap-2">
            <span>
              <span className="inline-block size-1.5 shrink-0 rounded-full bg-emerald-500" />{" "}
              Administrator session
            </span>
            <span>
              Last refresh {overview ? new Date(overview.timestamp).toLocaleTimeString() : "—"}
            </span>
          </footer>
        </main>
      </div>
      {selected && (
        <Sheet
          open={Boolean(selected)}
          onOpenChange={(open) => {
            if (!open && !busy) {
              setSelected(null);
              setSecret("");
            }
          }}
        >
          <SheetContent
            showCloseButton={false}
            className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl overflow-y-auto p-6 sm:p-8 [&_form]:space-y-5 [&_label]:flex-col [&_label]:items-start [&_label]:gap-2"
          >
            <header className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground">
                  {section.toUpperCase()}
                </p>
                <SheetTitle className="text-xl">
                  {selected._new
                    ? "New " + (section === "keys" ? "API key" : "storage item")
                    : selected.name || selected.key || "Record details"}
                </SheetTitle>
              </div>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setSelected(null);
                  setSecret("");
                }}
                aria-label="Close inspector"
              >
                ×
              </Button>
            </header>
            <SheetDescription>
              {section === "keys"
                ? "Give your application the access it needs. Fine-tune permissions and protect your installation."
                : "Inspect this record and apply changes to your installation."}
            </SheetDescription>
            {error && (
              <p
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"
                role="alert"
              >
                {error}
              </p>
            )}
            {section === "tenants" && selected && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  setConfirm({
                    text: `${selected.isActive ? "Suspend" : "Resume"} ${selected.name}? This affects every credential in this tenant.`,
                    run: async () => {
                      await request("tenants/" + selected._id, "PATCH", {
                        isActive: !selected.isActive,
                      });
                      setSelected(null);
                    },
                  })
                }
              >
                {selected.isActive ? "Suspend" : "Resume"} tenant
              </Button>
            )}
            {secret ? (
              <div className="space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-5 [&_h3]:font-semibold [&_p]:text-sm [&_p]:leading-6 [&_p]:text-muted-foreground [&_textarea]:min-h-24 [&_textarea]:font-mono [&_textarea]:text-xs">
                <h3>Save this key now.</h3>
                <p>
                  It will not appear in the key list. Keep it out of screenshots and public client
                  code.
                </p>
                <Textarea readOnly aria-label="Generated API key" value={secret} />
                <Button
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(secret).then(
                      () => setNotice("Key copied."),
                      () => setError("Clipboard unavailable. Select and copy the key manually."),
                    );
                  }}
                >
                  Copy key
                </Button>
              </div>
            ) : (
              <>
                {section === "history" ? (
                  <div className="space-y-5">
                    <div className="rounded-xl border bg-muted/20 p-4 text-sm">
                      <p>
                        Version {selected.version} · {display(selected.lastModified)}
                      </p>
                      <p className="mt-2 break-all text-muted-foreground">
                        {selected.userId} / {selected.key}
                      </p>
                      <p className="mt-2">
                        {selected.isDeleted
                          ? "This version represents a deletion."
                          : "This version contains a stored value."}
                      </p>
                    </div>
                    <Label>
                      Retained value
                      <Textarea
                        readOnly
                        rows={8}
                        value={
                          selected.isDeleted
                            ? "Deleted"
                            : JSON.stringify(JSON.parse(selected.value), null, 2)
                        }
                        className="font-mono text-xs"
                      />
                    </Label>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const preview = await request("history/preview", "POST", {
                            userId: selected.userId,
                            key: selected.key,
                            revision: selected._id,
                          });
                          setHistoryPreview({ ...preview, requestId: crypto.randomUUID() });
                        })
                      }
                    >
                      Preview restore
                    </Button>
                    {historyPreview && (
                      <section className="space-y-4 rounded-2xl border border-primary/30 bg-primary/5 p-5">
                        <h3 className="font-semibold">Review before restoring</h3>
                        <Label>
                          Current value
                          <Textarea
                            readOnly
                            rows={6}
                            className="font-mono text-xs"
                            value={
                              historyPreview.current && !historyPreview.current.isDeleted
                                ? JSON.stringify(JSON.parse(historyPreview.current.value), null, 2)
                                : "Deleted or missing"
                            }
                          />
                        </Label>
                        <details className="text-sm">
                          <summary className="cursor-pointer font-medium">Metadata changes</summary>
                          <Label className="mt-3">
                            Current metadata
                            <Textarea
                              readOnly
                              rows={3}
                              value={historyPreview.current?.metadata || "null"}
                            />
                          </Label>
                          <Label className="mt-3">
                            Retained metadata
                            <Textarea
                              readOnly
                              rows={3}
                              value={historyPreview.snapshot.metadata || "null"}
                            />
                          </Label>
                        </details>
                        <p className="text-sm text-muted-foreground">
                          This creates a new version and notifies connected clients. If another
                          client changes the item, restore will stop and ask for a fresh preview.
                        </p>
                        <Button
                          disabled={busy}
                          onClick={() =>
                            setConfirm({
                              text: "Restore this version? Apply the previewed value as a new change. This action is recorded in the activity log.",
                              run: async () => {
                                await request("history/restore", "POST", {
                                  userId: selected.userId,
                                  key: selected.key,
                                  revision: selected._id,
                                  expected: historyPreview.current
                                    ? {
                                        id: historyPreview.current.id,
                                        version: historyPreview.current.version,
                                      }
                                    : null,
                                  requestId: historyPreview.requestId,
                                });
                                mutationDone("Version restored and synchronized.");
                              },
                            })
                          }
                        >
                          Restore version
                        </Button>
                      </section>
                    )}
                  </div>
                ) : section === "storage" ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      setConfirm({
                        text:
                          "Save this value to " +
                          user +
                          "/" +
                          storageKey +
                          "? This overwrites the current value and synchronizes it to clients.",
                        run: async () => {
                          const value = JSON.parse(editor);
                          await request("storage", "POST", {
                            userId: user,
                            key: storageKey,
                            value,
                          });
                          mutationDone("Storage value saved.");
                        },
                      });
                    }}
                  >
                    <Label>
                      User ID
                      <Input
                        required
                        value={user}
                        onChange={(e) => setUser(e.target.value)}
                        readOnly={!selected._new}
                      />
                    </Label>
                    <Label>
                      Storage key
                      <Input
                        required
                        value={storageKey}
                        onChange={(e) => setStorageKey(e.target.value)}
                        readOnly={!selected._new}
                      />
                    </Label>
                    <Label>
                      JSON value
                      <Textarea
                        className="min-h-64 font-mono text-xs leading-6"
                        required
                        value={editor}
                        onChange={(e) => setEditor(e.target.value)}
                        spellCheck={false}
                      />
                    </Label>
                    <Button type="submit" variant="default" disabled={busy}>
                      Save & synchronize
                    </Button>
                    {!selected._new && (
                      <Button
                        variant="outline"
                        type="button"
                        className="text-destructive"
                        disabled={busy}
                        onClick={() =>
                          setConfirm({
                            text:
                              "Permanently delete " +
                              user +
                              "/" +
                              storageKey +
                              "? Connected clients will receive the deletion.",
                            run: async () => {
                              await request("storage/delete", "POST", {
                                userId: user,
                                key: storageKey,
                              });
                              mutationDone("Item deleted.");
                            },
                          })
                        }
                      >
                        Delete item
                      </Button>
                    )}
                  </form>
                ) : section === "keys" ? (
                  <form
                    key={selected._id || "new-key"}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const data = new FormData(e.currentTarget);
                      void run(async () => {
                        const policy = readKeyPolicy(
                          data,
                          selected._new ? null : selected.expiresAt,
                        );
                        const body = { ...policy, name, canRead, canWrite };
                        if (selected._new) {
                          const result = await request("keys", "POST", body);
                          setSecret(result.key);
                          refresh();
                        } else {
                          await request("keys/" + selected._id, "PATCH", body);
                          mutationDone("Key policy updated.");
                        }
                      });
                    }}
                  >
                    <Label>
                      Name
                      <Input
                        required
                        maxLength={250}
                        placeholder="e.g. Production web app"
                        className="h-11"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        disabled={rootKey || busy}
                      />
                    </Label>
                    {!rootKey && (
                      <section className="space-y-4 rounded-2xl border bg-muted/20 p-5">
                        <h3 className="font-semibold">Project & data access</h3>
                        <Label>
                          Project
                          {!selected._new && (
                            <input
                              type="hidden"
                              name="projectId"
                              value={
                                JSON.parse(selected.metadata || "{}").access?.projectId || "default"
                              }
                            />
                          )}
                          <select
                            name="projectId"
                            className="h-11 w-full rounded-md border bg-background px-3 text-sm"
                            disabled={!selected._new || busy}
                            defaultValue={
                              JSON.parse(selected.metadata || "{}").access?.projectId || "default"
                            }
                          >
                            <option value="default">Default (existing data)</option>
                            {projectsQuery.data?.items.map((project) => (
                              <option key={project._id} value={project._id}>
                                {project.name}
                              </option>
                            ))}
                          </select>
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Project binding cannot change after creation. Create projects from the
                          Projects page.
                        </p>
                        {(["readPrefixes", "writePrefixes"] as const).map((field) => (
                          <Label key={field}>
                            {field === "readPrefixes"
                              ? "Readable key prefixes"
                              : "Writable key prefixes"}
                            <Textarea
                              name={field}
                              rows={3}
                              placeholder="settings/"
                              defaultValue={(
                                JSON.parse(selected.metadata || "{}").access?.[field] || []
                              ).join("\n")}
                            />
                          </Label>
                        ))}
                        <p className="text-xs text-muted-foreground">
                          One literal prefix per line, case sensitive. Empty allows all keys for
                          that permission. Do not add *. Restricted write keys cannot clear the
                          entire project.
                        </p>
                      </section>
                    )}
                    <div className="grid grid-cols-2 gap-3 [&_label]:flex-row! [&_label]:items-start!">
                      <Label className="rounded-xl border bg-muted/20 p-4 has-[[data-checked]]:border-primary/40 has-[[data-checked]]:bg-primary/5">
                        <Checkbox
                          checked={canRead}
                          onCheckedChange={setCanRead}
                          disabled={rootKey || busy}
                        />
                        <span>
                          Read access
                          <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">
                            Fetch and subscribe to stored data.
                          </span>
                        </span>
                      </Label>
                      <Label className="rounded-xl border bg-muted/20 p-4 has-[[data-checked]]:border-primary/40 has-[[data-checked]]:bg-primary/5">
                        <Checkbox
                          checked={canWrite}
                          onCheckedChange={setCanWrite}
                          disabled={rootKey || busy}
                        />
                        <span>
                          Write access
                          <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">
                            Create, update and delete data.
                          </span>
                        </span>
                      </Label>
                    </div>
                    {rootKey ? (
                      <p className="rounded-lg border border-primary/15 bg-primary/5 p-4 text-sm text-primary">
                        Installation administrator. Permissions and activation are protected against
                        lockout.
                      </p>
                    ) : (
                      <>
                        <KeyPolicyFields policy={JSON.parse(editor)} disabled={busy} />
                        <div className="sticky bottom-0 -mx-2 border-t bg-popover/95 px-2 py-4 backdrop-blur">
                          <Button
                            className="h-11 w-full"
                            type="submit"
                            variant="default"
                            disabled={busy || (selected._new && Boolean(secret))}
                          >
                            {busy
                              ? "Saving…"
                              : selected._new && secret
                                ? "Key created"
                                : selected._new
                                  ? "Create API key"
                                  : "Save changes"}
                          </Button>
                          <p className="mt-2 text-center text-xs text-muted-foreground">
                            {selected._new
                              ? "Your secret will be shown once. Store it somewhere safe."
                              : "Changes apply to new requests immediately."}
                          </p>
                        </div>
                      </>
                    )}
                    {!selected._new && (
                      <>
                        <Button
                          variant="outline"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            setConfirm({
                              text: "Rotate this key? All clients using its old secret will need the replacement.",
                              run: async () => {
                                const result = await request(
                                  "keys/" + selected._id + "/rotate",
                                  "POST",
                                );
                                if (rootKey) setToken(result.key, token);
                                setSecret(result.key);
                                refresh();
                              },
                            })
                          }
                        >
                          Rotate secret
                        </Button>
                        {!rootKey && (
                          <Button
                            type="button"
                            variant={selected.isActive ? "destructive" : "default"}
                            disabled={busy}
                            onClick={() =>
                              setConfirm({
                                text:
                                  (selected.isActive ? "Disable" : "Enable") +
                                  " this application key?",
                                run: async () => {
                                  await request("keys/" + selected._id, "PATCH", {
                                    isActive: !selected.isActive,
                                  });
                                  mutationDone("Key activation updated.");
                                },
                              })
                            }
                          >
                            {selected.isActive ? "Disable key" : "Enable key"}
                          </Button>
                        )}
                      </>
                    )}
                  </form>
                ) : section === "quotas" ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(async () => {
                        await request("quotas/" + selected._id, "PATCH", JSON.parse(editor));
                        mutationDone("Stored quota settings updated.");
                      });
                    }}
                  >
                    <p className="rounded-lg border border-primary/15 bg-primary/5 p-4 text-sm text-primary">
                      These are stored settings. Not all quota fields are enforced on every backend
                      path.
                    </p>
                    <Label>
                      Quota settings · JSON
                      <Textarea
                        className="min-h-64 font-mono text-xs leading-6"
                        value={editor}
                        onChange={(e) => setEditor(e.target.value)}
                      />
                    </Label>
                    <Button type="submit" variant="default" disabled={busy}>
                      Save settings
                    </Button>
                  </form>
                ) : (
                  <>
                    <pre className="max-h-[60vh] overflow-auto rounded-xl border bg-muted/50 p-4 font-mono text-xs leading-6">
                      {editor}
                    </pre>
                    {section === "sessions" && !selected.disconnectedAt && selected.socketId && (
                      <Button
                        variant="destructive"
                        disabled={busy}
                        onClick={() =>
                          setConfirm({
                            text: "Disconnect this socket? Its client may reconnect automatically.",
                            run: async () => {
                              await request("sessions/" + selected._id + "/disconnect", "POST");
                              mutationDone("Disconnect sent.");
                            },
                          })
                        }
                      >
                        Disconnect session
                      </Button>
                    )}
                    {section === "conflicts" && (
                      <div>
                        <Label>
                          Resolution strategy
                          <NativeSelect
                            value={strategy}
                            onChange={(e) => setStrategy(e.target.value)}
                          >
                            <option value="last_write_wins">Use conflicting value</option>
                            <option value="first_write_wins">Keep original value</option>
                            <option value="merge">Merge values</option>
                          </NativeSelect>
                        </Label>
                        <p className="text-sm leading-6 text-muted-foreground">
                          Records a proposal only. Review resolvedValue, then apply it explicitly in
                          Data explorer.
                        </p>
                        <Button
                          variant="default"
                          disabled={busy}
                          onClick={() =>
                            setConfirm({
                              text: "Record this conflict resolution proposal? The stored item will remain unchanged.",
                              run: async () => {
                                const result = await request(
                                  "conflicts/" + selected._id + "/resolve",
                                  "POST",
                                  { strategy },
                                );
                                setEditor(JSON.stringify(result, null, 2));
                                setNotice("Proposal recorded; storage has not changed.");
                                refresh();
                              },
                            })
                          }
                        >
                          Record resolution
                        </Button>
                      </div>
                    )}
                  </>
                )}
                {!selected._new && (
                  <details className="space-y-3 border-t pt-5 text-sm">
                    <summary>All record fields</summary>
                    <pre className="max-h-[60vh] overflow-auto rounded-xl border bg-muted/50 p-4 font-mono text-xs leading-6">
                      {JSON.stringify(selected, null, 2)}
                    </pre>
                  </details>
                )}
              </>
            )}
          </SheetContent>
        </Sheet>
      )}
      <Dialog
        open={Boolean(confirm)}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogTitle>Confirm action</DialogTitle>
          <DialogDescription>{confirm?.text}</DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="default"
              disabled={busy}
              onClick={() => {
                const action = confirm?.run;
                setConfirm(null);
                if (action) void run(action);
              }}
            >
              Confirm
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
