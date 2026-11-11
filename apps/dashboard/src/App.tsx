import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { ConfirmDialog } from "./components/confirm-dialog";
import { ConnectApp } from "./components/connect-app";
import { ConsoleShell } from "./components/console-shell";
import { CreateWorkspaceForm } from "./components/create-workspace-form";
import { Inspector } from "./components/inspector";
import { Reports } from "./components/reports";
import { useAdminRequest } from "./lib/admin-api";
import { sections, type Page, type Row } from "./lib/console";
import { ConsoleProvider, type Confirm } from "./lib/console-actions";
import { useSession } from "./lib/session";
import { Overview } from "./pages/overview";
import { Records } from "./pages/records";
import { SignIn } from "./pages/sign-in";
import { System } from "./pages/system";
import { VersioningPage } from "./pages/versioning";

/** Manage a single installation with a memory-only administrator credential. */
export default function App({ section }: { section: string }) {
  const { token, sessionId, logout: endSession } = useSession();
  const queryClient = useQueryClient();
  const routeSearch = useSearch({ strict: false }) as ReturnType<
    typeof import("./lib/search").validateSearch
  >;
  const { q: query, page, ...dataScope } = routeSearch;
  const [actionError, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const [secret, setSecret] = useState("");
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  useEffect(() => {
    setSelected(null);
    setSecret("");
    setConfirm(null);
  }, [query, page, dataScope.scopeUser, dataScope.projectId, dataScope.tenantId, dataScope.branch]);

  const request = useAdminRequest(token);
  const resource = ["overview", "system"].includes(section) ? "audits" : section;
  const overviewQuery = useQuery<Row>({
    queryKey: ["console", sessionId, "overview"],
    queryFn: ({ signal }) => request("overview", "GET", undefined, token, signal),
    enabled: Boolean(token),
  });
  const recordsQuery = useQuery<Page>({
    queryKey: ["console", sessionId, "records", resource, page, query, dataScope],
    queryFn: ({ signal }) =>
      request(
        "resources/" +
          resource +
          "?" +
          new URLSearchParams({
            page: String(page),
            q: query,
            ...(dataScope.scopeUser ? (dataScope as Record<string, string>) : {}),
          }),
        "GET",
        undefined,
        token,
        signal,
      ),
    enabled:
      Boolean(token) &&
      !["system", "health", "usage", "changes", "versioning", "connect"].includes(section),
  });
  const mutation = useMutation({
    mutationFn: (action: () => Promise<void>) => action(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["console", sessionId] }),
  });
  const overview = overviewQuery.data;
  const records = recordsQuery.data;
  const loading = overviewQuery.isFetching || recordsQuery.isFetching;
  const busy = mutation.isPending;
  const error = actionError || overviewQuery.error?.message || recordsQuery.error?.message || "";
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["console", sessionId] });
  };

  /** Mutations are never retried automatically; keep failed drafts available for correction. */
  async function run(action: () => Promise<void>) {
    setError("");
    setNotice("");
    try {
      await mutation.mutateAsync(action);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Operation failed");
    } finally {
      mutation.reset();
    }
  }

  /** Open the inspector on a backend record; its body builds the draft from the record. */
  function inspect(row: Row) {
    setSelected(row);
    setSecret("");
  }

  /** Create a draft only; the API is changed after the user submits the form. */
  function newRecord() {
    inspect({
      _new: true,
      value: "{}",
      name: "",
      userId: dataScope.scopeUser || "",
      canRead: true,
      canWrite: false,
      allowedMethods: '["GET","POST","PUT","PATCH","DELETE"]',
    });
  }

  /** End the local admin session and remove all rendered private records. */
  function logout() {
    endSession();
    setSelected(null);
    setSecret("");
    setError("");
    setConfirm(null);
  }

  const mutationDone = (message: string) => {
    setSelected(null);
    setNotice(message);
    refresh();
  };
  const actions = { request, busy, run, refresh, setError, setNotice, setConfirm, mutationDone };

  if (!token)
    return (
      <ConsoleProvider value={actions}>
        <SignIn error={error} />
      </ConsoleProvider>
    );

  const title = sections.find((s) => s[0] === section)![1];

  return (
    <ConsoleProvider value={actions}>
      <ConsoleShell
        section={section}
        title={title}
        overview={overview}
        dataScope={dataScope}
        loading={loading}
        error={error}
        notice={notice}
        onNewRecord={newRecord}
        onLogout={logout}
        form={
          (section === "projects" || (section === "tenants" && overview?.tenantId === null)) && (
            <CreateWorkspaceForm
              section={section}
              onSecret={(created) => {
                setSecret(created.key);
                setSelected(created);
              }}
            />
          )
        }
      >
        {section === "overview" && overview && (
          <Overview overview={overview} dataScope={dataScope} />
        )}
        {section === "connect" ? (
          <ConnectApp />
        ) : section === "versioning" ? (
          <VersioningPage dataScope={dataScope} tenantId={overview?.tenantId} />
        ) : ["health", "usage", "changes"].includes(section) ? (
          <Reports kind={section} request={request} sessionId={sessionId} />
        ) : section === "system" && overview ? (
          <System overview={overview} />
        ) : (
          <Records
            section={section}
            title={title}
            records={records}
            page={page}
            query={query}
            loading={loading}
            dataScope={dataScope}
            onInspect={inspect}
          />
        )}
      </ConsoleShell>
      <Inspector
        section={section}
        selected={selected}
        secret={secret}
        error={error}
        dataScope={dataScope}
        onSelect={setSelected}
        onSecret={setSecret}
      />
      <ConfirmDialog confirm={confirm} />
    </ConsoleProvider>
  );
}
