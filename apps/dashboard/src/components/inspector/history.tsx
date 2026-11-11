import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { display, type Row } from "@/lib/console";
import { useConsole } from "@/lib/console-actions";

/** Preview a retained version against the current value before restoring it. */
export function HistoryInspector({ selected }: { selected: Row }) {
  const { request, run, busy, setConfirm, mutationDone } = useConsole();
  const [historyPreview, setHistoryPreview] = useState<Row | null>(null);
  return (
    <div className="space-y-5">
      <div className="rounded-xl border bg-muted/20 p-4 text-sm">
        <p>
          Version {selected.version} · {display(selected.lastModified)}
        </p>
        <p className="mt-2 break-all text-muted-foreground">
          {selected.userId} / {selected.key}
        </p>
        <p className="mt-2">
          {selected.isDeleted
            ? "This version represents a deletion."
            : "This version contains a stored value."}
        </p>
      </div>
      <Label>
        Retained value
        <Textarea
          readOnly
          rows={8}
          value={
            selected.isDeleted ? "Deleted" : JSON.stringify(JSON.parse(selected.value), null, 2)
          }
          className="font-mono text-xs"
        />
      </Label>
      <Button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const preview = await request("history/preview", "POST", {
              userId: selected.userId,
              key: selected.key,
              revision: selected._id,
            });
            setHistoryPreview({ ...preview, requestId: crypto.randomUUID() });
          })
        }
      >
        Preview restore
      </Button>
      {historyPreview && (
        <section className="space-y-4 rounded-2xl border border-primary/30 bg-primary/5 p-5">
          <h3 className="font-semibold">Review before restoring</h3>
          <Label>
            Current value
            <Textarea
              readOnly
              rows={6}
              className="font-mono text-xs"
              value={
                historyPreview.current && !historyPreview.current.isDeleted
                  ? JSON.stringify(JSON.parse(historyPreview.current.value), null, 2)
                  : "Deleted or missing"
              }
            />
          </Label>
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">Metadata changes</summary>
            <Label className="mt-3">
              Current metadata
              <Textarea readOnly rows={3} value={historyPreview.current?.metadata || "null"} />
            </Label>
            <Label className="mt-3">
              Retained metadata
              <Textarea readOnly rows={3} value={historyPreview.snapshot.metadata || "null"} />
            </Label>
          </details>
          <p className="text-sm text-muted-foreground">
            This creates a new version and notifies connected clients. If another client changes the
            item, restore will stop and ask for a fresh preview.
          </p>
          <Button
            disabled={busy}
            onClick={() =>
              setConfirm({
                text: "Restore this version? Apply the previewed value as a new change. This action is recorded in the activity log.",
                run: async () => {
                  await request("history/restore", "POST", {
                    userId: selected.userId,
                    key: selected.key,
                    revision: selected._id,
                    expected: historyPreview.current
                      ? {
                          id: historyPreview.current.id,
                          version: historyPreview.current.version,
                        }
                      : null,
                    requestId: historyPreview.requestId,
                  });
                  mutationDone("Version restored and synchronized.");
                },
              })
            }
          >
            Restore version
          </Button>
        </section>
      )}
    </div>
  );
}
