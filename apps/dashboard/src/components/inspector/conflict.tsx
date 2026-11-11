import { useState } from "react";
import { Button } from "@/components/motion/button/base";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/motion/select";
import type { Row } from "@/lib/console";
import { useConsole } from "@/lib/console-actions";
import { helpClass, jsonClass, labelClass } from "./sheet";

/** Show one conflict and record a resolution proposal; the recorded result replaces the JSON. */
export function ConflictInspector({
  selected,
  strategy,
  onStrategyChange,
}: {
  selected: Row;
  strategy: string;
  onStrategyChange: (strategy: string) => void;
}) {
  const { request, busy, refresh, setConfirm, setNotice } = useConsole();
  const [editor, setEditor] = useState(() => JSON.stringify(selected, null, 2));
  return (
    <>
      <pre className={jsonClass}>{editor}</pre>
      <div className="space-y-4 border-t pt-5">
        <div className="space-y-1.5">
          <span className={labelClass}>Resolution strategy</span>
          <Select value={strategy} onValueChange={onStrategyChange}>
            <SelectTrigger>
              {/* The trigger takes no aria-label; this names it for screen readers. */}
              <span className="sr-only">Resolution strategy: </span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="last_write_wins">Use conflicting value</SelectItem>
              <SelectItem value="first_write_wins">Keep original value</SelectItem>
              <SelectItem value="merge">Merge values</SelectItem>
            </SelectContent>
          </Select>
          <p className={helpClass}>
            Records a proposal only. Review resolvedValue, then apply it explicitly in Data
            explorer.
          </p>
        </div>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() =>
            setConfirm({
              text: "Record this conflict resolution proposal? The stored item will remain unchanged.",
              run: async () => {
                const result = await request("conflicts/" + selected._id + "/resolve", "POST", {
                  strategy,
                });
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
    </>
  );
}
