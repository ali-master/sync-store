import { useState } from "react";
import { Button } from "@/components/motion/button/base";
import { Input } from "@/components/motion/input";
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
  // The field holds its value in React state, so it is cleared here rather than by form.reset().
  const [name, setName] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-2xl border bg-card p-5"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void run(async () => {
          const created = await request(section, "POST", { name: data.get("name") });
          if (created.key) onSecret(created);
          setName("");
          setNotice(
            section === "tenants"
              ? "Tenant created. Save its administrator key and use it to sign in to the tenant workspace."
              : "Project created. Create an API key bound to this project.",
          );
        });
      }}
    >
      <Input
        className="min-w-0 flex-1"
        label={section === "tenants" ? "Tenant name" : "Project name"}
        name="name"
        required
        maxLength={100}
        placeholder="Production workspace"
        value={name}
        onChange={setName}
      />
      <Button type="submit" className="h-11" disabled={busy}>
        Create {section === "tenants" ? "tenant" : "project"}
      </Button>
    </form>
  );
}
