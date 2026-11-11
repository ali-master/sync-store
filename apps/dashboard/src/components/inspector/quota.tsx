import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { quotaFields, type Row } from "@/lib/console";
import { useConsole } from "@/lib/console-actions";

/** Edit the stored quota settings of one user as JSON. */
export function QuotaInspector({ selected }: { selected: Row }) {
  const { request, run, busy, mutationDone } = useConsole();
  const [editor, setEditor] = useState(() =>
    JSON.stringify(Object.fromEntries(quotaFields.map((f) => [f, selected[f]])), null, 2),
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await request("quotas/" + selected._id, "PATCH", JSON.parse(editor));
          mutationDone("Stored quota settings updated.");
        });
      }}
    >
      <p className="rounded-lg border border-primary/15 bg-primary/5 p-4 text-sm text-primary">
        These are stored settings. Not all quota fields are enforced on every backend path.
      </p>
      <Label>
        Quota settings · JSON
        <Textarea
          className="min-h-64 font-mono text-xs leading-6"
          value={editor}
          onChange={(e) => setEditor(e.target.value)}
        />
      </Label>
      <Button type="submit" variant="default" disabled={busy}>
        Save settings
      </Button>
    </form>
  );
}
