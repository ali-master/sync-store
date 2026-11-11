import { GitBranch, SlidersHorizontal } from "lucide-react";
import { AnimatedBadge } from "@/components/motion/animated-badge";
import { Button } from "@/components/motion/button/base";
import { Input } from "@/components/motion/input";

const fieldClasses = { label: "text-xs text-muted-foreground" };

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
    <details className="scope-bar group rounded-2xl border bg-card">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 rounded-2xl px-5 py-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <SlidersHorizontal className="size-3.5 text-muted-foreground" />
        <span className="font-medium">Data scope</span>
        <span className="text-muted-foreground">/</span>
        <span className={scope.scopeUser ? "font-mono" : undefined}>
          {scope.scopeUser
            ? `${scope.projectId || "default"} / ${scope.scopeUser}`
            : "All permitted data"}
        </span>
        {scope.scopeUser && (
          <AnimatedBadge status="info" size="sm" icon={<GitBranch className="size-3" />}>
            {scope.branch || "main"}
          </AnimatedBadge>
        )}
        <span className="ml-auto font-medium text-primary group-open:hidden">Change scope</span>
      </summary>
      <form
        className="grid gap-4 border-t p-5 sm:grid-cols-2 xl:grid-cols-5"
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
        <Input
          // The tenant can arrive after the bar is shown; the field starts again from it.
          key={tenantId || ""}
          label="Tenant"
          classNames={fieldClasses}
          name="tenantId"
          defaultValue={tenantId || scope.tenantId || ""}
          placeholder="Default installation"
          disabled={!!tenantId}
        />
        <Input
          label="Project"
          classNames={fieldClasses}
          name="projectId"
          defaultValue={scope.projectId || "default"}
        />
        <Input
          label="User"
          classNames={fieldClasses}
          name="userId"
          required
          maxLength={128}
          defaultValue={scope.scopeUser || ""}
          placeholder="customer-42"
        />
        <Input
          label="Branch"
          classNames={fieldClasses}
          name="branch"
          defaultValue={scope.branch || "main"}
        />
        <div className="flex items-end gap-2">
          <Button type="submit" className="h-11">
            Apply scope
          </Button>
          <Button type="button" variant="ghost" className="h-11" onClick={() => onChange({})}>
            Reset
          </Button>
        </div>
      </form>
    </details>
  );
}
