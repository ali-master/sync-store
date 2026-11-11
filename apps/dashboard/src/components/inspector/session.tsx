import { Button } from "@/components/ui/button";
import type { Row } from "@/lib/console";
import { useConsole } from "@/lib/console-actions";
import { GenericInspector } from "./generic";

/** Show one connection and let the operator disconnect it while it is live. */
export function SessionInspector({ selected }: { selected: Row }) {
  const { request, busy, setConfirm, mutationDone } = useConsole();
  return (
    <>
      <GenericInspector selected={selected} />
      {!selected.disconnectedAt && selected.socketId && (
        <Button
          variant="destructive"
          disabled={busy}
          onClick={() =>
            setConfirm({
              text: "Disconnect this socket? Its client may reconnect automatically.",
              run: async () => {
                await request("sessions/" + selected._id + "/disconnect", "POST");
                mutationDone("Disconnect sent.");
              },
            })
          }
        >
          Disconnect session
        </Button>
      )}
    </>
  );
}
