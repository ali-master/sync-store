import { useState } from "react";
import type { DataScope } from "@/components/data-scope";
import { Button } from "@/components/motion/button/base";
import { Input } from "@/components/motion/input";
import type { Row } from "@/lib/console";
import { useConsole } from "@/lib/console-actions";
import { labelClass, textareaClass } from "./sheet";

/** Edit one stored JSON value; saving and deleting are reviewed in the confirm dialog. */
export function StorageInspector({ selected, dataScope }: { selected: Row; dataScope: DataScope }) {
  const { request, busy, setError, setConfirm, mutationDone } = useConsole();
  const [user, setUser] = useState<string>(selected.userId || "");
  const [storageKey, setStorageKey] = useState<string>(selected.key || "");
  const [editor, setEditor] = useState<string>(() => {
    try {
      return JSON.stringify(JSON.parse(selected.value), null, 2);
    } catch {
      return selected.value || "{}";
    }
  });
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        let value: unknown;
        try {
          value = JSON.parse(editor);
        } catch {
          setError("Enter valid JSON before reviewing this change.");
          return;
        }
        setError("");
        setConfirm({
          before: selected._new ? "New item" : JSON.stringify(JSON.parse(selected.value), null, 2),
          after: JSON.stringify(value, null, 2),
          text:
            "Save this value to " +
            user +
            "/" +
            storageKey +
            "? This overwrites the current value and synchronizes it to clients.",
          run: async () => {
            await request("storage", "POST", {
              userId: user,
              key: storageKey,
              ...(selected._new && dataScope.scopeUser ? { scope: dataScope } : {}),
              value,
            });
            mutationDone("Storage value saved.");
          },
        });
      }}
    >
      <Input
        label="User ID"
        required
        value={user}
        onChange={setUser}
        readOnly={!selected._new}
        classNames={{ input: "font-mono text-sm", field: selected._new ? "" : "bg-muted/40" }}
      />
      <Input
        label="Storage key"
        required
        value={storageKey}
        onChange={setStorageKey}
        readOnly={!selected._new}
        classNames={{ input: "font-mono text-sm", field: selected._new ? "" : "bg-muted/40" }}
      />
      <label className="block space-y-1.5">
        <span className={labelClass}>JSON value</span>
        <textarea
          className={textareaClass + " min-h-64"}
          required
          value={editor}
          onChange={(e) => setEditor(e.target.value)}
          spellCheck={false}
        />
      </label>
      <div className="flex flex-wrap gap-2 border-t pt-5">
        <Button type="submit" variant="primary" disabled={busy}>
          Save & synchronize
        </Button>
        {!selected._new && (
          <Button
            variant="outline"
            type="button"
            className="text-destructive"
            disabled={busy}
            onClick={() =>
              setConfirm({
                text:
                  "Permanently delete " +
                  user +
                  "/" +
                  storageKey +
                  "? Connected clients will receive the deletion.",
                run: async () => {
                  await request("storage/delete", "POST", {
                    userId: user,
                    key: storageKey,
                  });
                  mutationDone("Item deleted.");
                },
              })
            }
          >
            Delete item
          </Button>
        )}
      </div>
    </form>
  );
}
