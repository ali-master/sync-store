import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { DataScope } from "@/components/data-scope";
import { RecordsTable } from "@/components/records-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { columns, display, labels, type Page, type Row } from "@/lib/console";

/** Search and page one resource; the submitted query and page live in the URL. */
export function Records({
  section,
  title,
  records,
  page,
  query,
  loading,
  dataScope,
  onInspect,
}: {
  section: string;
  title: string;
  records?: Page;
  page: number;
  query: string;
  loading: boolean;
  dataScope: DataScope;
  onInspect: (row: Row) => void;
}) {
  const routerNavigate = useNavigate();
  const [search, setSearch] = useState(query);
  useEffect(() => {
    setSearch(query);
  }, [query, page, dataScope.scopeUser, dataScope.projectId, dataScope.tenantId, dataScope.branch]);
  const activeColumns = columns[section] || columns.audits;

  function setPage(next: number) {
    void routerNavigate({
      to: section === "overview" ? "/" : "/" + section,
      search: { ...dataScope, page: next, q: query },
    });
  }

  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-4 p-6 [&_h2]:font-semibold [&_span]:text-xs [&_span]:text-muted-foreground">
        <div>
          <h2>{section === "overview" ? "Recent recorded activity" : title}</h2>
          <span>{records ? records.total.toLocaleString() + " records" : "Loading records"}</span>
        </div>
        <form
          className="flex w-full items-center gap-2 sm:w-80"
          onSubmit={(e) => {
            e.preventDefault();
            void routerNavigate({
              to: section === "overview" ? "/" : "/" + section,
              search: { ...dataScope, page: 1, q: search },
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
        onInspect={onInspect}
        display={display}
      />
    </section>
  );
}
