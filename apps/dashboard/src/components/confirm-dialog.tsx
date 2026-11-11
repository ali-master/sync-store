import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useConsole, type Confirm } from "@/lib/console-actions";

/** Ask before a change is sent; the action then runs through the shared mutation. */
export function ConfirmDialog({ confirm }: { confirm: Confirm | null }) {
  const { busy, run, setConfirm } = useConsole();
  return (
    <Dialog
      open={Boolean(confirm)}
      onOpenChange={(open) => {
        if (!open) setConfirm(null);
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogTitle>Confirm action</DialogTitle>
        <DialogDescription>{confirm?.text}</DialogDescription>
        {confirm?.after !== undefined && (
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <p className="mb-2 text-xs font-medium text-muted-foreground">When opened</p>
              <pre className="max-h-72 overflow-auto rounded-lg border bg-muted/30 p-3 text-xs">
                {confirm.before}
              </pre>
            </div>
            <div className="min-w-0">
              <p className="mb-2 text-xs font-medium text-primary">After</p>
              <pre className="max-h-72 overflow-auto rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
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
            variant="default"
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
      </DialogContent>
    </Dialog>
  );
}
