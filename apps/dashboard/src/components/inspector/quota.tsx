import { useState } from "react";
import { Alert, AlertContent, AlertDescription, AlertIcon } from "@/components/motion/alert";
import { Button } from "@/components/motion/button/base";
import { quotaFields, type Row } from "@/lib/console";
import { useConsole } from "@/lib/console-actions";
import { labelClass, textareaClass } from "./sheet";

/** Edit the stored quota settings of one user as JSON. */
export function QuotaInspector({ selected }: { selected: Row }) {
  const { request, run, busy, mutationDone } = useConsole();
  const [editor, setEditor] = useState(() =>
    JSON.stringify(Object.fromEntries(quotaFields.map((f) => [f, selected[f]])), null, 2),
  );
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await request("quotas/" + selected._id, "PATCH", JSON.parse(editor));
          mutationDone("Stored quota settings updated.");
        });
      }}
    >
      <Alert variant="info">
        <AlertIcon />
        <AlertContent>
          <AlertDescription className="text-primary">
            These are stored settings. Not all quota fields are enforced on every backend path.
          </AlertDescription>
        </AlertContent>
      </Alert>
      <label className="block space-y-1.5">
        <span className={labelClass}>Quota settings · JSON</span>
        <textarea
          className={textareaClass + " min-h-64"}
          value={editor}
          onChange={(e) => setEditor(e.target.value)}
        />
      </label>
      <Button type="submit" variant="primary" disabled={busy}>
        Save settings
      </Button>
    </form>
  );
}
