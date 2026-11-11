import { useNavigate } from "@tanstack/react-router";
import type { DataScope } from "@/components/data-scope";
import { Versioning } from "@/components/versioning";
import { useConsole } from "@/lib/console-actions";
import { useSession } from "@/lib/session";

/** Bind branches and commits to the data scope held in the URL. */
export function VersioningPage({
  dataScope,
  tenantId,
}: {
  dataScope: DataScope;
  tenantId?: string | null;
}) {
  const routerNavigate = useNavigate();
  const { request } = useConsole();
  const { sessionId } = useSession();
  return (
    <Versioning
      onBranchChange={(branch) =>
        void routerNavigate({
          to: "/versioning",
          search: { ...dataScope, branch, page: 1, q: "" },
        })
      }
      key={JSON.stringify(dataScope)}
      request={request}
      sessionId={sessionId}
      tenantId={tenantId}
      initialScope={
        dataScope.scopeUser
          ? {
              userId: dataScope.scopeUser,
              projectId: dataScope.projectId || "default",
              tenantId: tenantId || dataScope.tenantId || "",
              branch: dataScope.branch || "main",
            }
          : undefined
      }
    />
  );
}
