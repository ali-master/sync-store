import type { Row } from "@/lib/console";

/** Show a read-only record as JSON. */
export function GenericInspector({ selected }: { selected: Row }) {
  return (
    <pre className="max-h-[60vh] overflow-auto rounded-xl border bg-muted/50 p-4 font-mono text-xs leading-6">
      {JSON.stringify(selected, null, 2)}
    </pre>
  );
}
