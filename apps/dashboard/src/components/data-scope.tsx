import { GitBranch, SlidersHorizontal } from "lucide-react";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Button } from "./ui/button";

export type DataScope = {
  scopeUser?: string;
  projectId?: string;
  tenantId?: string;
  branch?: string;
};
/** Make the selected data owner visible and send the same scope to every data view. */
export function DataScopeBar({
  scope,
  tenantId,
  onChange,
}: {
  scope: DataScope;
  tenantId?: string | null;
  onChange: (scope: DataScope) => void;
}) {
  return (
    <details className="scope-bar group rounded-lg border bg-card">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-3 text-xs">
        <SlidersHorizontal className="size-3.5 text-muted-foreground" />
        <span className="font-medium">Data scope</span>
        <span className="text-muted-foreground">/</span>
        <span>
          {scope.scopeUser
            ? `${scope.projectId || "default"} / ${scope.scopeUser}`
            : "All permitted data"}
        </span>
        {scope.scopeUser && (
          <span className="flex items-center gap-1.5 rounded-md bg-primary/5 px-2 py-1 text-primary">
            <GitBranch className="size-3" />
            {scope.branch || "main"}
          </span>
        )}
        <span className="ml-auto text-muted-foreground group-open:hidden">Change scope</span>
      </summary>
      <form
        className="grid gap-4 border-t p-4 sm:grid-cols-2 xl:grid-cols-5"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          onChange({
            scopeUser: String(data.get("userId")).trim(),
            projectId: String(data.get("projectId") || "default"),
            tenantId: tenantId || String(data.get("tenantId") || ""),
            branch: String(data.get("branch") || "main"),
          });
          event.currentTarget.closest("details")?.removeAttribute("open");
        }}
      >
        <Label className="grid gap-2 text-xs">
          Tenant
          <Input
            name="tenantId"
            defaultValue={tenantId || scope.tenantId || ""}
            placeholder="Default installation"
            disabled={!!tenantId}
          />
        </Label>
        <Label className="grid gap-2 text-xs">
          Project
          <Input name="projectId" defaultValue={scope.projectId || "default"} />
        </Label>
        <Label className="grid gap-2 text-xs">
          User
          <Input
            name="userId"
            required
            maxLength={128}
            defaultValue={scope.scopeUser || ""}
            placeholder="customer-42"
          />
        </Label>
        <Label className="grid gap-2 text-xs">
          Branch
          <Input name="branch" defaultValue={scope.branch || "main"} />
        </Label>
        <div className="flex items-end gap-2">
          <Button type="submit" size="sm">
            Apply scope
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange({})}>
            Reset
          </Button>
        </div>
      </form>
    </details>
  );
}
