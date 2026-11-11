import type { Row } from "@/lib/console";
import { jsonClass } from "./sheet";

/** Show a read-only record as JSON. */
export function GenericInspector({ selected }: { selected: Row }) {
  return <pre className={jsonClass}>{JSON.stringify(selected, null, 2)}</pre>;
}
