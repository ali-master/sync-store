import { useState } from "react";
import type { DataScope } from "@/components/data-scope";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Row } from "@/lib/console";
import { useConsole } from "@/lib/console-actions";

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
      <Label>
        User ID
        <Input
          required
          value={user}
          onChange={(e) => setUser(e.target.value)}
          readOnly={!selected._new}
        />
      </Label>
      <Label>
        Storage key
        <Input
          required
          value={storageKey}
          onChange={(e) => setStorageKey(e.target.value)}
          readOnly={!selected._new}
        />
      </Label>
      <Label>
        JSON value
        <Textarea
          className="min-h-64 font-mono text-xs leading-6"
          required
          value={editor}
          onChange={(e) => setEditor(e.target.value)}
          spellCheck={false}
        />
      </Label>
      <Button type="submit" variant="default" disabled={busy}>
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
    </form>
  );
}
