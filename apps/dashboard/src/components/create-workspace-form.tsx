import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Row } from "@/lib/console";
import { useConsole } from "@/lib/console-actions";

/** Create a project or tenant; a new tenant's administrator key is handed back once. */
export function CreateWorkspaceForm({
  section,
  onSecret,
}: {
  section: string;
  onSecret: (created: Row) => void;
}) {
  const { request, run, busy, setNotice } = useConsole();
  return (
    <form
      className="flex flex-wrap items-end gap-4 rounded-2xl border bg-card p-5"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        void run(async () => {
          const created = await request(section, "POST", { name: data.get("name") });
          if (created.key) onSecret(created);
          form.reset();
          setNotice(
            section === "tenants"
              ? "Tenant created. Save its administrator key and use it to sign in to the tenant workspace."
              : "Project created. Create an API key bound to this project.",
          );
        });
      }}
    >
      <Label className="min-w-0 flex-1">
        {section === "tenants" ? "Tenant name" : "Project name"}
        <Input name="name" required maxLength={100} placeholder="Production workspace" />
      </Label>
      <Button type="submit" disabled={busy}>
        Create {section === "tenants" ? "tenant" : "project"}
      </Button>
    </form>
  );
}
