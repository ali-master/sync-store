import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Row } from "@/lib/console";
import { useConsole } from "@/lib/console-actions";

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
      <pre className="max-h-[60vh] overflow-auto rounded-xl border bg-muted/50 p-4 font-mono text-xs leading-6">
        {editor}
      </pre>
      <div>
        <Label>
          Resolution strategy
          <Select
            items={[
              { value: "last_write_wins", label: "Use conflicting value" },
              { value: "first_write_wins", label: "Keep original value" },
              { value: "merge", label: "Merge values" },
            ]}
            value={strategy}
            onValueChange={(value) => {
              if (value !== null) onStrategyChange(value);
            }}
          >
            <SelectTrigger aria-label="Resolution strategy" className="w-full min-w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectItem value="last_write_wins">Use conflicting value</SelectItem>
              <SelectItem value="first_write_wins">Keep original value</SelectItem>
              <SelectItem value="merge">Merge values</SelectItem>
            </SelectContent>
          </Select>
        </Label>
        <p className="text-sm leading-6 text-muted-foreground">
          Records a proposal only. Review resolvedValue, then apply it explicitly in Data explorer.
        </p>
        <Button
          variant="default"
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
