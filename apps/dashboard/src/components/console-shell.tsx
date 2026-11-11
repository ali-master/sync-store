import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { BookOpen, GitBranch, LogOut, Menu, RefreshCw } from "lucide-react";
import { ConsoleNav } from "@/components/console-nav";
import { DataScopeBar, type DataScope } from "@/components/data-scope";
import { ThemePicker } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { descriptions, type Row } from "@/lib/console";
import { useConsole } from "@/lib/console-actions";
import logo from "../../../../assets/logo.svg";

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
  const [mobileMenu, setMobileMenu] = useState(false);
  const scopedView = [
    "storage",
    "history",
    "sessions",
    "conflicts",
    "audits",
    "archives",
    "quotas",
    "versioning",
  ].includes(section);

  const sidebarContent = (
    <>
      <ConsoleNav
        section={section}
        platform={overview?.tenantId === null}
        busy={busy}
        scope={dataScope}
        onNavigate={() => setMobileMenu(false)}
      />
      <div className="shrink-0 space-y-2 border-t px-2 py-3">
        <a className="console-nav-link" href="/api/docs" target="_blank" rel="noreferrer">
          <BookOpen className="size-4" />
          API reference
        </a>
        <div className="flex items-center gap-2 px-2 pt-2">
          <span className="grid size-7 place-items-center rounded-full bg-primary/10 text-[10px] font-medium text-primary">
            AD
          </span>
          <div className="min-w-0 flex-1 text-xs">
            <b className="font-medium">Administrator</b>
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
              {overview?.tenantId ? "Tenant workspace" : "Installation access"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onLogout}
            disabled={busy}
            aria-label="Sign out"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className="fixed bottom-0 top-[52px] left-0 z-30 hidden w-[248px] flex-col border-r bg-card px-2 lg:flex">
        {sidebarContent}
      </aside>
      <Sheet open={mobileMenu} onOpenChange={setMobileMenu}>
        <SheetContent side="left" className="w-72 gap-0 p-3" showCloseButton={false}>
          <SheetTitle className="sr-only">Console navigation</SheetTitle>
          <SheetDescription className="sr-only">Choose an installation view.</SheetDescription>
          {sidebarContent}
        </SheetContent>
      </Sheet>

      <div className="min-w-0 pt-[52px] lg:ml-[248px]">
        <header className="fixed inset-x-0 top-0 z-40 flex h-[52px] items-center justify-between gap-2 border-b bg-card px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2 text-xs">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              aria-label="Toggle navigation"
              aria-expanded={mobileMenu}
              onClick={() => setMobileMenu((v) => !v)}
            >
              <Menu />
            </Button>
            <Link
              to="/"
              search={{ ...dataScope, page: 1, q: "" }}
              className="mr-1 flex shrink-0 items-center gap-2 text-sm font-semibold"
            >
              <img src={logo} alt="" className="size-5" />
              Sync Store
            </Link>
            <span aria-hidden="true" className="hidden text-lg font-light text-border sm:inline">
              /
            </span>
            <span className="hidden text-muted-foreground sm:inline">
              {overview?.tenantId ? "Tenant workspace" : "Your installation"}
            </span>
            <span aria-hidden="true" className="hidden text-lg font-light text-border sm:inline">
              /
            </span>
            <span className="hidden truncate font-medium text-muted-foreground md:inline">
              {dataScope.projectId || "default"}
            </span>
            {scopedView && dataScope.scopeUser && (
              <span className="hidden items-center gap-1 rounded-md bg-primary/5 px-2 py-1 text-primary sm:flex">
                <GitBranch className="size-3" />
                {dataScope.branch || "main"}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-3">
            <ThemePicker />
            <span className="hidden items-center gap-1.5 text-[10px] text-muted-foreground sm:flex">
              <span
                className={
                  "size-1.5 rounded-full " +
                  (error ? "bg-amber-500" : overview ? "bg-emerald-500" : "bg-slate-300")
                }
              />
              {error ? "Needs attention" : overview ? "API connected" : "Connecting"}
            </span>
            <Button
              variant="ghost"
              size="icon"
              disabled={loading}
              onClick={refresh}
              aria-label="Refresh data"
            >
              <RefreshCw className={"size-3.5 " + (loading ? "animate-spin" : "")} />
            </Button>
          </div>
        </header>
        <main
          className={
            "console-workspace mx-auto space-y-5 px-4 py-6 sm:px-8 sm:py-10 " +
            (section === "versioning" || section === "projects" || section === "tenants"
              ? "max-w-[920px]"
              : "max-w-[1120px]")
          }
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-sm font-semibold">{title}</h1>
              <p className="mt-2 max-w-2xl text-xs leading-5 text-muted-foreground">
                {descriptions[section]}
              </p>
            </div>
            {["storage", "keys"].includes(section) && (
              <Button variant="default" disabled={busy} onClick={onNewRecord}>
                ＋ {section === "keys" ? "Create API key" : "Add item"}
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
          {children}
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
    </div>
  );
}
