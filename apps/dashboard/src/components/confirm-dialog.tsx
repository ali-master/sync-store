import { useCallback, useId, useRef, type ReactNode } from "react";
import { useIsPresent } from "motion/react";
import { Button } from "@/components/motion/button/base";
import { CenterMorphModal, CenterMorphModalContent } from "@/components/motion/center-morph-modal";
import { useConsole, type Confirm } from "@/lib/console-actions";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";

/**
 * The modal keeps its own focus loop but does not join the shared trap stack, so an inspector
 * drawer underneath would pull focus back and close on the same Escape. Joining as the innermost
 * trap silences the drawer while the question is open, and returns focus to the opener after.
 */
function TopLayer({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(useIsPresent(), ref);
  return (
    <div ref={ref} tabIndex={-1} className="space-y-5 p-6 outline-none">
      {children}
    </div>
  );
}

/** Ask before a change is sent; the action then runs through the shared mutation. */
export function ConfirmDialog({ confirm }: { confirm: Confirm | null }) {
  const { busy, run, setConfirm } = useConsole();
  const descriptionId = useId();
  // Stable on purpose: the modal refocuses its first control whenever this callback changes.
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open) setConfirm(null);
    },
    [setConfirm],
  );
  return (
    <CenterMorphModal open={Boolean(confirm)} onOpenChange={onOpenChange}>
      <CenterMorphModalContent
        ariaLabel="Confirm action"
        ariaDescribedBy={descriptionId}
        showCloseButton={false}
        className={confirm?.after !== undefined ? "max-w-2xl" : undefined}
      >
        <TopLayer>
          <div className="space-y-2">
            <h2 className="text-lg font-semibold tracking-tight">Confirm action</h2>
            <p id={descriptionId} className="text-sm leading-6 text-muted-foreground">
              {confirm?.text}
            </p>
          </div>
          {confirm?.after !== undefined && (
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <p className="mb-2 text-xs font-medium text-muted-foreground">When opened</p>
                <pre className="max-h-72 overflow-auto rounded-xl border bg-muted p-3 font-mono text-xs leading-5">
                  {confirm.before}
                </pre>
              </div>
              <div className="min-w-0">
                <p className="mb-2 text-xs font-medium text-primary">After</p>
                <pre className="max-h-72 overflow-auto rounded-xl border border-primary/30 bg-accent p-3 font-mono text-xs leading-5 text-accent-foreground">
                  {confirm.after}
                </pre>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                const action = confirm?.run;
                setConfirm(null);
                if (action) void run(action);
              }}
            >
              Confirm
            </Button>
          </div>
        </TopLayer>
      </CenterMorphModalContent>
    </CenterMorphModal>
  );
}
