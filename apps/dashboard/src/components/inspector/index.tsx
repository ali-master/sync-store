import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DataScope } from "@/components/data-scope";
import type { Page, Row } from "@/lib/console";
import { useConsole } from "@/lib/console-actions";
import { useSession } from "@/lib/session";
import { ConflictInspector } from "./conflict";
import { GenericInspector } from "./generic";
import { HistoryInspector } from "./history";
import { KeyInspector } from "./key";
import { QuotaInspector } from "./quota";
import { SessionInspector } from "./session";
import { InspectorSheet } from "./sheet";
import { StorageInspector } from "./storage";
import { TenantInspector } from "./tenant";

/** Open the selected record in its section's inspector; each body drafts its own edits. */
export function Inspector({
  section,
  selected,
  secret,
  error,
  dataScope,
  onSelect,
  onSecret,
}: {
  section: string;
  selected: Row | null;
  secret: string;
  error: string;
  dataScope: DataScope;
  onSelect: (row: Row | null) => void;
  onSecret: (secret: string) => void;
}) {
  const { token, sessionId } = useSession();
  const { request } = useConsole();
  // Held here, not in the conflict body, so the next conflict opens with the last strategy.
  const [strategy, setStrategy] = useState("last_write_wins");
  // Loaded with the keys page, not on first open, so the project list is ready in the form.
  const projectsQuery = useQuery<Page>({
    queryKey: ["console", sessionId, "projects"],
    queryFn: async () => {
      const first: Page = await request("resources/projects");
      const items = [...first.items];
      for (let page = 2; items.length < first.total; page++) {
        const next: Page = await request("resources/projects?page=" + page);
        if (!next.items.length) break;
        items.push(...next.items);
      }
      return { ...first, items };
    },
    enabled: Boolean(token) && section === "keys",
  });
  if (!selected) return null;

  return (
    <InspectorSheet
      section={section}
      selected={selected}
      secret={secret}
      error={error}
      actions={
        section === "tenants" && (
          <TenantInspector selected={selected} onDone={() => onSelect(null)} />
        )
      }
      onClose={() => {
        onSelect(null);
        onSecret("");
      }}
    >
      {section === "history" ? (
        <HistoryInspector selected={selected} />
      ) : section === "storage" ? (
        <StorageInspector selected={selected} dataScope={dataScope} />
      ) : section === "keys" ? (
        <KeyInspector
          selected={selected}
          secret={secret}
          projects={projectsQuery.data?.items}
          onSecret={onSecret}
        />
      ) : section === "quotas" ? (
        <QuotaInspector selected={selected} />
      ) : section === "sessions" ? (
        <SessionInspector selected={selected} />
      ) : section === "conflicts" ? (
        <ConflictInspector selected={selected} strategy={strategy} onStrategyChange={setStrategy} />
      ) : (
        <GenericInspector selected={selected} />
      )}
    </InspectorSheet>
  );
}
