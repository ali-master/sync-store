import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { BookOpen, GitBranch, LogOut, PanelLeft, Plus, RefreshCw, Search } from "lucide-react";
import { ConsoleNav, useSectionNavigate, visibleNav } from "@/components/console-nav";
import { DataScopeBar, type DataScope } from "@/components/data-scope";
import {
  Alert,
  AlertAction,
  AlertContent,
  AlertDescription,
  AlertTitle,
} from "@/components/motion/alert";
import { AnimatedBadge } from "@/components/motion/animated-badge";
import {
  AnimatedSidebar,
  AnimatedSidebarContent,
  AnimatedSidebarFooter,
  AnimatedSidebarHeader,
  AnimatedSidebarInset,
  AnimatedSidebarProvider,
  AnimatedSidebarRail,
  AnimatedSidebarTrigger,
  useAnimatedSidebar,
} from "@/components/motion/animated-sidebar";
import {
  AnimatedToastStack,
  useAnimatedToastStack,
} from "@/components/motion/animated-toast-stack";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/motion/breadcrumb";
import { Button } from "@/components/motion/button/base";
import { CommandPalette, type CommandItem } from "@/components/motion/command-palette";
import { ThemePicker } from "@/components/theme-provider";
import { descriptions, type Row } from "@/lib/console";
import { useConsole } from "@/lib/console-actions";
import logo from "../../../../assets/logo.svg";

const scopedSections = [
  "storage",
  "history",
  "sessions",
  "conflicts",
  "audits",
  "archives",
  "quotas",
  "versioning",
];

/** The brand and the signed-in operator fold to their marks when the sidebar is an icon rail. */
function SidebarBrand({ workspace }: { workspace: string }) {
  const { open, isMobile } = useAnimatedSidebar();
  const expanded = open || isMobile;
  return (
    <div className="flex h-10 items-center gap-2.5 px-1.5">
      <img src={logo} alt="" className="size-7 shrink-0" />
      {expanded && (
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-semibold tracking-tight">Sync Store</p>
          <p className="truncate text-[11px] text-muted-foreground">{workspace}</p>
        </div>
      )}
    </div>
  );
}

function SidebarAccount({
  workspace,
  busy,
  onLogout,
}: {
  workspace: string;
  busy: boolean;
  onLogout: () => void;
}) {
  const { open, isMobile } = useAnimatedSidebar();
  const expanded = open || isMobile;
  return (
    <div className="flex items-center gap-2.5 rounded-xl border bg-background p-1.5">
      {expanded && (
        <>
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-[11px] font-semibold text-primary">
            AD
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-xs font-medium">Administrator</p>
            <p className="truncate text-[11px] text-muted-foreground">{workspace}</p>
          </div>
        </>
      )}
      <Button variant="ghost" size="icon" onClick={onLogout} disabled={busy} aria-label="Sign out">
        <LogOut className="size-4" />
      </Button>
    </div>
  );
}

/** Frame every signed-in view with navigation, the data scope and request feedback. */
export function ConsoleShell({
  section,
  title,
  overview,
  dataScope,
  loading,
  error,
  notice,
  form,
  onNewRecord,
  onLogout,
  children,
}: {
  section: string;
  title: string;
  overview?: Row;
  dataScope: DataScope;
  loading: boolean;
  error: string;
  notice: string;
  /** Rendered between the data scope and the banners. */
  form?: ReactNode;
  onNewRecord: () => void;
  onLogout: () => void;
  children: ReactNode;
}) {
  const { busy, refresh } = useConsole();
  const routerNavigate = useNavigate();
  const go = useSectionNavigate(dataScope);
  const { toasts, showToast, dismissToast } = useAnimatedToastStack({ limit: 3 });
  const [palette, setPalette] = useState(false);
  const scopedView = scopedSections.includes(section);
  const platform = overview?.tenantId === null;
  const workspace = overview?.tenantId ? "Tenant workspace" : "Installation";

  /** A completed change is announced once; errors stay on the page until they are resolved. */
  useEffect(() => {
    if (notice) showToast({ title: notice, status: "success" });
  }, [notice, showToast]);

  const commands = useMemo<CommandItem[]>(
    () => [
      ...visibleNav(platform).flatMap((group) =>
        group.items.map((item) => ({
          id: item.id,
          label: item.title,
          group: group.label,
          icon: item.icon,
          keywords: [item.id],
          onSelect: () => go(item.id),
        })),
      ),
      {
        id: "refresh",
        label: "Refresh data",
        group: "Actions",
        icon: RefreshCw,
        onSelect: refresh,
      },
      {
        id: "api-reference",
        label: "Open API reference",
        group: "Actions",
        icon: BookOpen,
        onSelect: () => window.open("/api/docs", "_blank", "noreferrer"),
      },
      { id: "sign-out", label: "Sign out", group: "Actions", icon: LogOut, onSelect: onLogout },
    ],
    // `go` closes over the scope; the scope values are what change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [platform, refresh, onLogout, JSON.stringify(dataScope)],
  );

  return (
    <AnimatedSidebarProvider style={{ "--sidebar-width": "16.5rem" }}>
      <AnimatedSidebar variant="inset" collapsible="icon" ariaLabel="Console navigation">
        <AnimatedSidebarHeader>
          <SidebarBrand workspace={workspace} />
        </AnimatedSidebarHeader>
        <AnimatedSidebarContent>
          <ConsoleNav section={section} platform={platform} busy={busy} scope={dataScope} />
        </AnimatedSidebarContent>
        <AnimatedSidebarFooter>
          <SidebarAccount workspace={workspace} busy={busy} onLogout={onLogout} />
        </AnimatedSidebarFooter>
        <AnimatedSidebarRail />
      </AnimatedSidebar>

      <AnimatedSidebarInset>
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 rounded-t-2xl border-b bg-background/85 px-3 backdrop-blur sm:px-5">
          <AnimatedSidebarTrigger>
            <PanelLeft className="size-4" />
          </AnimatedSidebarTrigger>
          <Breadcrumb className="min-w-0 flex-1">
            <BreadcrumbList maxItems={10}>
              <BreadcrumbItem className="hidden sm:inline-flex">{workspace}</BreadcrumbItem>
              <BreadcrumbSeparator className="hidden sm:inline-flex" />
              <BreadcrumbItem className="hidden md:inline-flex">
                {dataScope.projectId || "default"}
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:inline-flex" />
              <BreadcrumbItem>
                <BreadcrumbPage>{title}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          {scopedView && dataScope.scopeUser && (
            <AnimatedBadge status="info" size="sm" icon={<GitBranch className="size-3" />}>
              {dataScope.branch || "main"}
            </AnimatedBadge>
          )}
          <button
            type="button"
            aria-label="Search pages and actions"
            aria-keyshortcuts="Meta+K Control+K"
            onClick={() => setPalette(true)}
            className="hidden h-9 items-center gap-2 rounded-xl border bg-card px-3 text-xs text-muted-foreground transition-colors hover:text-foreground sm:flex"
          >
            <Search className="size-3.5" />
            Search
            <kbd className="rounded-md border bg-muted px-1.5 font-mono text-[10px]">⌘K</kbd>
          </button>
          <AnimatedBadge
            className="hidden sm:inline-flex"
            size="sm"
            pulse={!error && Boolean(overview)}
            status={error ? "warning" : overview ? "success" : "loading"}
          >
            {error ? "Needs attention" : overview ? "API connected" : "Connecting"}
          </AnimatedBadge>
          <Button
            variant="ghost"
            size="icon"
            disabled={loading}
            onClick={refresh}
            aria-label="Refresh data"
          >
            <RefreshCw className={"size-4 " + (loading ? "animate-spin" : "")} />
          </Button>
          <ThemePicker />
        </header>

        {/* Every page uses the full width of the content area; only prose keeps a reading width. */}
        <div className="w-full min-w-0 flex-1 space-y-6 px-4 py-6 sm:px-8 sm:py-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
              <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
                {descriptions[section]}
              </p>
            </div>
            {["storage", "keys"].includes(section) && (
              <Button variant="primary" disabled={busy} onClick={onNewRecord}>
                <Plus className="size-4" />
                {section === "keys" ? "Create API key" : "Add item"}
              </Button>
            )}
          </div>
          {scopedView && (
            <DataScopeBar
              key={JSON.stringify(dataScope)}
              scope={dataScope}
              tenantId={overview?.tenantId}
              onChange={(scope) => {
                void routerNavigate({ to: "/" + section, search: { ...scope, page: 1, q: "" } });
              }}
            />
          )}
          {!scopedView && dataScope.scopeUser && (
            <p className="text-xs text-muted-foreground">
              This page shows the administrator's permitted workspace. Data scope is retained for
              data and history pages.
            </p>
          )}
          {form}
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertContent>
                <AlertTitle>Something needs attention</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </AlertContent>
              <AlertAction>
                <Button variant="outline" size="sm" onClick={refresh}>
                  Retry
                </Button>
              </AlertAction>
            </Alert>
          )}
          {children}
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="inline-block size-1.5 shrink-0 rounded-full bg-success" />
              Administrator session · memory only
            </span>
            <span role="status">
              {loading
                ? "Updating from your API…"
                : "Last refresh " +
                  (overview ? new Date(overview.timestamp).toLocaleTimeString() : "—")}
            </span>
          </footer>
        </div>
      </AnimatedSidebarInset>

      <CommandPalette
        items={commands}
        open={palette}
        onOpenChange={setPalette}
        placeholder="Go to a page or run an action…"
      />
      <AnimatedToastStack
        toasts={toasts}
        onDismiss={dismissToast}
        position="bottom-right"
        placement="fixed"
      />
    </AnimatedSidebarProvider>
  );
}
