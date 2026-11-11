import { useState } from "react";
import { Button } from "@/components/motion/button/base";
import { display, type Row } from "@/lib/console";
import { useConsole } from "@/lib/console-actions";
import { helpClass, labelClass, textareaClass } from "./sheet";

/** Preview a retained version against the current value before restoring it. */
export function HistoryInspector({ selected }: { selected: Row }) {
  const { request, run, busy, setConfirm, mutationDone } = useConsole();
  const [historyPreview, setHistoryPreview] = useState<Row | null>(null);
  return (
    <div className="space-y-5">
      <div className="space-y-2 rounded-xl border bg-card p-4 text-sm">
        <p className="font-medium">
          Version {selected.version} · {display(selected.lastModified)}
        </p>
        <p className="font-mono text-xs break-all text-muted-foreground">
          {selected.userId} / {selected.key}
        </p>
        <p className={helpClass}>
          {selected.isDeleted
            ? "This version represents a deletion."
            : "This version contains a stored value."}
        </p>
      </div>
      <label className="block space-y-1.5">
        <span className={labelClass}>Retained value</span>
        <textarea
          readOnly
          rows={8}
          value={
            selected.isDeleted ? "Deleted" : JSON.stringify(JSON.parse(selected.value), null, 2)
          }
          className={textareaClass}
        />
      </label>
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
        <section className="space-y-4 border-t pt-5">
          <h3 className="text-sm font-semibold">Review before restoring</h3>
          <label className="block space-y-1.5">
            <span className={labelClass}>Current value</span>
            <textarea
              readOnly
              rows={6}
              className={textareaClass}
              value={
                historyPreview.current && !historyPreview.current.isDeleted
                  ? JSON.stringify(JSON.parse(historyPreview.current.value), null, 2)
                  : "Deleted or missing"
              }
            />
          </label>
          <details>
            <summary className="cursor-pointer text-sm font-medium marker:text-muted-foreground">
              Metadata changes
            </summary>
            <label className="mt-3 block space-y-1.5">
              <span className={labelClass}>Current metadata</span>
              <textarea
                readOnly
                rows={3}
                className={textareaClass}
                value={historyPreview.current?.metadata || "null"}
              />
            </label>
            <label className="mt-3 block space-y-1.5">
              <span className={labelClass}>Retained metadata</span>
              <textarea
                readOnly
                rows={3}
                className={textareaClass}
                value={historyPreview.snapshot.metadata || "null"}
              />
            </label>
          </details>
          <p className={helpClass}>
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
