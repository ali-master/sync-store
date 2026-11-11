import { useMemo } from "react";
import { ArrowUpRight, Database } from "lucide-react";
import { AnimatedBadge } from "@/components/motion/animated-badge";
import { Button } from "@/components/motion/button/base";
import { Pagination } from "@/components/motion/pagination";
import { Table } from "@/components/motion/table";
import type { TableColumn } from "@/components/motion/table/types";

type RecordRow = Record<string, any>;
const emptyRows: RecordRow[] = [];
const pageSize = 25;

/** "lastUsedAt" reads as "Last used at" when a field has no curated label. */
function heading(field: string) {
  const words = field
    .replace(/^_/, "")
    .replace(/([A-Z])/g, " $1")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Fields whose values are identifiers or stored text, shown in the monospace face. */
const technical = /(^_id$|Id$|^key$|^revision$|^value$|^action$)/;

/**
 * Show one server page. Sorting and filtering stay on the server: ordering only the 25 loaded rows
 * would present a partial dataset as if it were the whole.
 */
export function RecordsTable({
  fields,
  labels,
  records,
  page,
  loading,
  query,
  onPageChange,
  onInspect,
  display,
}: {
  fields: string[];
  labels: Record<string, string>;
  records?: { items: RecordRow[]; total: number };
  page: number;
  loading: boolean;
  query: string;
  onPageChange: (page: number) => void;
  onInspect: (record: RecordRow) => void;
  display: (value: any) => string;
}) {
  const columns = useMemo<TableColumn<RecordRow>[]>(
    () => [
      ...fields.map((field): TableColumn<RecordRow> => ({
        key: field,
        header: labels[field] || heading(field),
        cell: (row) =>
          typeof row[field] === "boolean" ? (
            <AnimatedBadge size="sm" status={row[field] ? "success" : "neutral"} showIcon={false}>
              {display(row[field])}
            </AnimatedBadge>
          ) : (
            <span
              className={
                "block max-w-64 truncate " + (technical.test(field) ? "font-mono text-xs" : "")
              }
              title={display(row[field])}
            >
              {display(row[field])}
            </span>
          ),
      })),
      {
        key: "inspect",
        header: <span className="sr-only">Inspect</span>,
        align: "right",
        width: "56px",
        cell: (row) => (
          <Button
            variant="ghost"
            size="icon"
            aria-label={"Inspect " + (row.name || row.key || row._id)}
            onClick={() => onInspect(row)}
          >
            <ArrowUpRight className="size-4" />
          </Button>
        ),
      },
    ],
    [fields, labels, onInspect, display],
  );
  const pages = Math.max(1, Math.ceil((records?.total ?? 0) / pageSize));
  const empty = !loading && !records?.items.length;

  return (
    <>
      <div aria-busy={loading}>
        <Table
          data={records?.items ?? emptyRows}
          columns={columns}
          getRowId={(row, index) => String(row._id ?? index)}
          loading={loading && !records}
          skeletonRows={6}
          emptyState={
            empty ? (
              <div className="grid justify-items-center gap-3 px-6 py-14 text-center">
                <span className="grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
                  <Database className="size-5" aria-hidden="true" />
                </span>
                <h3 className="font-medium">{query ? "No matching records." : "A clean slate."}</h3>
                <p className="max-w-sm text-sm text-muted-foreground">
                  {query
                    ? "Try another search or clear the filter."
                    : "Records will appear when your applications use this installation."}
                </p>
              </div>
            ) : undefined
          }
        />
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3 text-xs text-muted-foreground">
        <span>
          Page {page} of {pages} · {pageSize} records per page
        </span>
        <Pagination totalPages={pages} page={page} onPageChange={onPageChange} />
      </footer>
    </>
  );
}
