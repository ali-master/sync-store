import { useMemo } from "react";
import {
  createColumnHelper,
  rowPaginationFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ArrowUpRight, ChevronLeft, ChevronRight, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";

type RecordRow = Record<string, any>;
const features = tableFeatures({ rowPaginationFeature });
const helper = createColumnHelper<typeof features, RecordRow>();
const emptyRows: RecordRow[] = [];

/** Model the server's page without sorting or filtering only a misleading partial dataset. */
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
  const columns = useMemo(
    () =>
      helper.columns([
        ...fields.map((field) =>
          helper.accessor((row) => row[field], {
            id: field,
            header: labels[field] || field.replace(/([A-Z])/g, " $1"),
            cell: (info) =>
              typeof info.getValue() === "boolean" ? (
                <Badge variant={info.getValue() ? "secondary" : "outline"}>
                  {display(info.getValue())}
                </Badge>
              ) : (
                <span className="block max-w-64 truncate" title={display(info.getValue())}>
                  {display(info.getValue())}
                </span>
              ),
          }),
        ),
        helper.display({
          id: "inspect",
          header: () => <span className="sr-only">Inspect</span>,
          cell: ({ row }) => (
            <Button
              variant="ghost"
              size="icon"
              aria-label={"Inspect " + (row.original.name || row.original.key || row.original._id)}
              onClick={() => onInspect(row.original)}
            >
              <ArrowUpRight />
            </Button>
          ),
        }),
      ]),
    [fields, labels, onInspect, display],
  );
  const table = useTable({
    features,
    columns,
    data: records?.items ?? emptyRows,
    getRowId: (row) => row._id,
    manualPagination: true,
    autoResetPageIndex: false,
    rowCount: records?.total ?? 0,
    state: { pagination: { pageIndex: page - 1, pageSize: 25 } },
    onPaginationChange: (updater) => {
      const current = { pageIndex: page - 1, pageSize: 25 };
      const next = typeof updater === "function" ? updater(current) : updater;
      onPageChange(next.pageIndex + 1);
    },
  });
  return (
    <>
      <Table aria-label="Installation records" aria-busy={loading}>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className="px-6 text-xs font-medium text-muted-foreground"
                >
                  {!header.isPlaceholder && <table.FlexRender header={header} />}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getAllCells().map((cell) => (
                <TableCell key={cell.id} className="px-6 py-3">
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!loading && !records?.items.length && (
        <div className="grid justify-items-center gap-3 px-6 py-16 text-center">
          <Database className="size-8 text-muted-foreground/50" />
          <h3 className="font-medium">{query ? "No matching records." : "A clean slate."}</h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            {query
              ? "Try another search or clear the filter."
              : "Records will appear when your applications use this installation."}
          </p>
        </div>
      )}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-4 text-xs text-muted-foreground">
        <span>
          Page {page} of {Math.max(1, table.getPageCount())} · 25 records per page
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={loading || !table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            <ChevronLeft /> Previous
          </Button>
          <Button
            variant="outline"
            disabled={loading || !records || !table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            Next <ChevronRight />
          </Button>
        </div>
      </footer>
    </>
  );
}
