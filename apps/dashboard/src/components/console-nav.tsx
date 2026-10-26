import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  Database,
  GitBranch,
  History,
  KeyRound,
  Layers,
  LayoutDashboard,
  Network,
  Settings2,
  ShieldCheck,
  Archive,
  Gauge,
  ScrollText,
  Unplug,
  Users,
  Search,
  PlugZap,
} from "lucide-react";
import type { DataScope } from "./data-scope";

const groups = [
  {
    label: "Workspace",
    items: [
      ["overview", "Overview", LayoutDashboard],
      ["storage", "Data explorer", Database],
      ["versioning", "Branches & commits", GitBranch],
      ["history", "Version history", History],
    ],
  },
  {
    label: "Access",
    items: [
      ["keys", "API keys", KeyRound],
      ["projects", "Projects", Layers],
      ["tenants", "Tenants", Users],
    ],
  },
  {
    label: "Monitor",
    items: [
      ["health", "Sync health", Activity],
      ["usage", "Usage & quotas", Gauge],
      ["changes", "Changes & growth", BarChart3],
      ["sessions", "Connections", Network],
      ["audits", "Activity log", ScrollText],
    ],
  },
  {
    label: "Advanced",
    items: [
      ["conflicts", "Conflicts", Unplug],
      ["quotas", "User quotas", ShieldCheck],
      ["analytics", "Analytics records", BarChart3],
      ["archives", "Archives", Archive],
      ["system", "System", Settings2],
    ],
  },
] as const;

/** Group operator tasks while keeping every existing resource reachable and searchable. */
export function ConsoleNav({
  section,
  platform,
  busy,
  scope,
  onNavigate,
}: {
  section: string;
  platform: boolean;
  busy: boolean;
  scope: DataScope;
  onNavigate: () => void;
}) {
  const [query, setQuery] = useState("");
  function items(group: (typeof groups)[number]) {
    return group.items
      .filter(
        ([id, title]) =>
          (id !== "tenants" || platform) && title.toLowerCase().includes(query.toLowerCase()),
      )
      .map(([id, title, Icon]) => (
        <Link
          key={id}
          to={id === "overview" ? "/" : "/" + id}
          search={{ ...scope, page: 1, q: "" }}
          disabled={busy}
          onClick={onNavigate}
          aria-current={section === id ? "page" : undefined}
          className="console-nav-link"
        >
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          <span>{title}</span>
        </Link>
      ));
  }
  return (
    <nav aria-label="Console navigation" className="min-h-0 flex-1 overflow-y-auto py-3">
      <label className="mx-1 mb-4 flex items-center gap-2 rounded-md border bg-background px-2.5 py-2 text-muted-foreground">
        <Search className="size-3.5" />
        <input
          className="min-w-0 w-full bg-transparent text-xs outline-none"
          aria-label="Find a page"
          placeholder="Find a page…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <Link
        to="/connect"
        search={{ ...scope, page: 1, q: "" }}
        onClick={onNavigate}
        aria-current={section === "connect" ? "page" : undefined}
        className="console-nav-link mb-3"
      >
        <PlugZap className="size-4" />
        Connect your app
      </Link>
      {groups.map((group) =>
        group.label === "Advanced" && !query ? (
          <details
            key={group.label}
            open={group.items.some(([id]) => id === section) || undefined}
            className="mt-3"
          >
            <summary className="cursor-pointer px-3 py-2 text-[11px] font-medium text-muted-foreground">
              Advanced
            </summary>
            {items(group)}
          </details>
        ) : (
          <div key={group.label} className="mb-4">
            <p className="px-3 pb-2 pt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {group.label}
            </p>
            {items(group)}
          </div>
        ),
      )}
      {query &&
        !groups.some((g) =>
          g.items.some(([, name]) => name.toLowerCase().includes(query.toLowerCase())),
        ) && <p className="p-3 text-xs text-muted-foreground">No matching pages.</p>}
    </nav>
  );
}
