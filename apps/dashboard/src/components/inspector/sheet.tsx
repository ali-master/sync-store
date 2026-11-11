import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import type { Row } from "@/lib/console";
import { useConsole } from "@/lib/console-actions";

/** Frame one record: its title, the last error, a one-time secret or the section's body. */
export function InspectorSheet({
  section,
  selected,
  secret,
  error,
  actions,
  onClose,
  children,
}: {
  section: string;
  selected: Row;
  secret: string;
  error: string;
  /** Stays visible above a one-time secret. */
  actions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const { busy, setError, setNotice } = useConsole();
  return (
    <Sheet
      open={Boolean(selected)}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <SheetContent
        showCloseButton={false}
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl overflow-y-auto p-6 sm:p-8 [&_form]:space-y-5 [&_label]:flex-col [&_label]:items-start [&_label]:gap-2"
      >
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground">
              {section.toUpperCase()}
            </p>
            <SheetTitle className="text-xl">
              {selected._new
                ? "New " + (section === "keys" ? "API key" : "storage item")
                : selected.name || selected.key || "Record details"}
            </SheetTitle>
          </div>
          <Button variant="outline" disabled={busy} onClick={onClose} aria-label="Close inspector">
            ×
          </Button>
        </header>
        <SheetDescription>
          {section === "keys"
            ? "Give your application the access it needs. Fine-tune permissions and protect your installation."
            : "Inspect this record and apply changes to your installation."}
        </SheetDescription>
        {error && (
          <p
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}
        {actions}
        {secret ? (
          <div className="space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-5 [&_h3]:font-semibold [&_p]:text-sm [&_p]:leading-6 [&_p]:text-muted-foreground [&_textarea]:min-h-24 [&_textarea]:font-mono [&_textarea]:text-xs">
            <h3>Save this key now.</h3>
            <p>
              It will not appear in the key list. Keep it out of screenshots and public client code.
            </p>
            <Textarea readOnly aria-label="Generated API key" value={secret} />
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(secret).then(
                  () => setNotice("Key copied."),
                  () => setError("Clipboard unavailable. Select and copy the key manually."),
                );
              }}
            >
              Copy key
            </Button>
          </div>
        ) : (
          <>
            {children}
            {!selected._new && (
              <details className="space-y-3 border-t pt-5 text-sm">
                <summary>All record fields</summary>
                <pre className="max-h-[60vh] overflow-auto rounded-xl border bg-muted/50 p-4 font-mono text-xs leading-6">
                  {JSON.stringify(selected, null, 2)}
                </pre>
              </details>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
