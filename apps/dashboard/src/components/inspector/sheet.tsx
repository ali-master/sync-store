import type { ReactNode } from "react";
import { Copy, X } from "lucide-react";
import { Alert, AlertContent, AlertIcon, AlertTitle } from "@/components/motion/alert";
import { AnimatedBadge } from "@/components/motion/animated-badge";
import { Button } from "@/components/motion/button/base";
import { Drawer } from "@/components/motion/drawer";
import type { Row } from "@/lib/console";
import { useConsole } from "@/lib/console-actions";

/** Field styles shared by the inspector bodies; beUI has no textarea and no standalone label. */
export const labelClass = "block px-1 text-sm font-medium";
export const helpClass = "text-xs leading-5 text-muted-foreground";
export const textareaClass =
  "block w-full rounded-xl border bg-background px-3 py-2 font-mono text-xs leading-5 outline-none placeholder:text-muted-foreground/60 read-only:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring";
export const jsonClass =
  "max-h-[60vh] overflow-auto rounded-xl border bg-muted p-4 font-mono text-xs leading-5";

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
  const title = selected._new
    ? "New " + (section === "keys" ? "API key" : "storage item")
    : selected.name || selected.key || "Record details";
  const description =
    section === "keys"
      ? "Give your application the access it needs. Fine-tune permissions and protect your installation."
      : "Inspect this record and apply changes to your installation.";
  return (
    <Drawer
      open={Boolean(selected)}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      side="right"
      // The drawer takes a name only, so the description is announced with the title.
      ariaLabel={title + ". " + description}
      className="w-full max-w-full sm:max-w-xl"
    >
      <header className="flex items-start justify-between gap-4 border-b px-6 py-5">
        <div className="min-w-0 space-y-1">
          <p className="text-[11px] font-semibold tracking-[0.2em] text-muted-foreground">
            {section.toUpperCase()}
          </p>
          <h2 className="text-xl font-semibold tracking-tight break-words">{title}</h2>
          <p className="text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          disabled={busy}
          onClick={onClose}
          aria-label="Close inspector"
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </header>
      <div
        className="flex-1 space-y-5 overflow-y-auto px-6 py-5"
        onKeyDown={(event) => {
          // An open select closes itself on Escape; without this the drawer would close with it.
          if (
            event.key === "Escape" &&
            (event.target as HTMLElement).closest('[role="listbox"], [aria-expanded="true"]')
          )
            event.preventDefault();
        }}
      >
        {error && (
          <Alert variant="destructive">
            <AlertIcon />
            <AlertContent>
              <AlertTitle>{error}</AlertTitle>
            </AlertContent>
          </Alert>
        )}
        {actions}
        {secret ? (
          <section className="space-y-4 rounded-2xl border-2 border-primary bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Save this key now.</h3>
              <AnimatedBadge status="warning" size="sm">
                Shown only once
              </AnimatedBadge>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              It will not appear in the key list. Keep it out of screenshots and public client code.
            </p>
            <textarea
              readOnly
              aria-label="Generated API key"
              value={secret}
              className="block field-sizing-content min-h-24 w-full resize-none rounded-xl bg-foreground p-4 font-mono text-xs leading-5 break-all text-background outline-none selection:bg-primary selection:text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button
              variant="primary"
              className="w-full"
              onClick={() => {
                void navigator.clipboard.writeText(secret).then(
                  () => setNotice("Key copied."),
                  () => setError("Clipboard unavailable. Select and copy the key manually."),
                );
              }}
            >
              <Copy className="size-4" aria-hidden="true" />
              Copy key
            </Button>
          </section>
        ) : (
          <>
            {children}
            {!selected._new && (
              <details className="border-t pt-5">
                <summary className="cursor-pointer text-sm font-semibold marker:text-muted-foreground">
                  All record fields
                </summary>
                <pre className={jsonClass + " mt-3"}>{JSON.stringify(selected, null, 2)}</pre>
              </details>
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}
