import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { DataScope } from "@/components/data-scope";
import { RecordsTable } from "@/components/records-table";
import { Search } from "lucide-react";
import { Button } from "@/components/motion/button/base";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/motion/card";
import { Input } from "@/components/motion/input";
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
    <Card className="overflow-hidden">
      <CardHeader className="gap-y-4">
        <CardTitle as="h2">{section === "overview" ? "Recent recorded activity" : title}</CardTitle>
        <CardDescription>
          {records ? records.total.toLocaleString() + " records" : "Loading records"}
        </CardDescription>
        <form
          className="col-span-full flex w-full items-center gap-2 sm:max-w-md"
          onSubmit={(e) => {
            e.preventDefault();
            void routerNavigate({
              to: section === "overview" ? "/" : "/" + section,
              search: { ...dataScope, page: 1, q: search },
            });
          }}
        >
          <Input
            aria-label="Search records"
            placeholder="Search records…"
            value={search}
            onChange={setSearch}
            leftIcon={<Search className="size-4" />}
            className="flex-1"
          />
          <Button variant="outline" type="submit">
            Search
          </Button>
        </form>
      </CardHeader>
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
    </Card>
  );
}
