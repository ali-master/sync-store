import { Button } from "@/components/ui/button";
import type { Row } from "@/lib/console";
import { useConsole } from "@/lib/console-actions";

/** Suspend or resume a whole tenant after confirmation. */
export function TenantInspector({ selected, onDone }: { selected: Row; onDone: () => void }) {
  const { request, busy, setConfirm } = useConsole();
  return (
    <Button
      variant="outline"
      disabled={busy}
      onClick={() =>
        setConfirm({
          text: `${selected.isActive ? "Suspend" : "Resume"} ${selected.name}? This affects every credential in this tenant.`,
          run: async () => {
            await request("tenants/" + selected._id, "PATCH", {
              isActive: !selected.isActive,
            });
            onDone();
          },
        })
      }
    >
      {selected.isActive ? "Suspend" : "Resume"} tenant
    </Button>
  );
}
