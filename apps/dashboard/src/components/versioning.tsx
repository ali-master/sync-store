import { useCallback, useId, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, GitBranch, GitFork, History, RefreshCw } from "lucide-react";
import { Alert, AlertContent, AlertIcon, AlertTitle } from "./motion/alert";
import { AnimatedBadge } from "./motion/animated-badge";
import { Button } from "./motion/button/base";
import {
  Card,
  CARD_TARGET_CLASS,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./motion/card";
import { CenterMorphModal, CenterMorphModalContent } from "./motion/center-morph-modal";
import { Input } from "./motion/input";
import { Loader } from "./motion/loader";

type Scope = { userId: string; projectId: string; tenantId: string; branch: string };

/** Commit and branch heads are UUIDs; the first group is enough to tell them apart on screen. */
const shortId = (id: string) => id.slice(0, 8);

/** A fixed owner and explicit head make whole-tree restores reviewable and concurrency safe. */
export function Versioning({
  request,
  sessionId,
  tenantId,
  initialScope,
  onBranchChange,
}: {
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
  sessionId: string;
  tenantId?: string | null;
  initialScope?: Scope;
  onBranchChange?: (branch: string) => void;
}) {
  const client = useQueryClient();
  const scope = initialScope ?? null;
  const [branch, setBranch] = useState(initialScope?.branch || "main");
  const [restore, setRestore] = useState<any>(null);
  const [notice, setNotice] = useState("");
  const restoreDescription = useId();
  const query = useQuery({
    queryKey: ["console", sessionId, "versioning", scope, branch],
    enabled: !!scope,
    queryFn: () => request("versioning?" + new URLSearchParams({ ...scope!, branch })),
  });
  const head = query.data?.branches.find((b: any) => b.name === branch)?.head ?? null;
  const mutation = useMutation({
    mutationFn: ({ action, body }: { action: string; body: any }) =>
      request("versioning/" + action, "POST", { ...scope, branch, ...body }),
    onSuccess: () => {
      setRestore(null);
      setNotice("Saved. The branch head has been refreshed.");
      void client.invalidateQueries({ queryKey: ["console", sessionId, "versioning"] });
    },
  });
  /** Stable, so the open dialog does not re-run its focus handling on every render. */
  const closeRestore = useCallback((open: boolean) => {
    if (!open) setRestore(null);
  }, []);
  return (
    <div className="grid min-w-0 gap-4">
      {!scope && (
        <Card>
          <CardContent className="grid justify-items-center gap-3 py-8 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
              <GitBranch className="size-5" aria-hidden="true" />
            </span>
            <p className="max-w-sm leading-6 text-muted-foreground">
              Choose a user in Data scope above to inspect their branches and immutable commit
              history.
            </p>
          </CardContent>
        </Card>
      )}
      {(query.error || mutation.error) && (
        <Alert variant="destructive">
          <AlertIcon />
          <AlertContent>
            <AlertTitle className="break-words">
              {query.error?.message || mutation.error?.message}
            </AlertTitle>
          </AlertContent>
        </Alert>
      )}
      {notice && (
        <Alert variant="success">
          <AlertIcon />
          <AlertContent>
            <AlertTitle>{notice}</AlertTitle>
          </AlertContent>
        </Alert>
      )}
      {query.isFetching && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader size={16} label="Loading branch history…" />
          <span aria-hidden="true">Loading branch history…</span>
        </p>
      )}
      {scope && query.data && (
        <>
          <Card>
            <CardHeader>
              <CardTitle as="h2">Branches</CardTitle>
              <CardDescription className="break-all font-mono text-xs">
                HEAD · {head || "No commits yet"}
              </CardDescription>
              <CardAction>
                <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                  Refresh
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-5">
              <div
                role="group"
                aria-label="Current branch"
                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
              >
                {query.data.branches.map((b: any) => (
                  <Card key={b.name} size="compact" interactive selected={b.name === branch}>
                    <CardContent className="flex items-center gap-3">
                      <GitBranch
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          aria-pressed={b.name === branch}
                          className={
                            CARD_TARGET_CLASS +
                            " block max-w-full text-left font-medium outline-none"
                          }
                          onClick={() => {
                            if (b.name === branch) return;
                            setBranch(b.name);
                            onBranchChange?.(b.name);
                            setRestore(null);
                            mutation.reset();
                          }}
                        >
                          <span className="block truncate">{b.name}</span>
                        </button>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {b.head ? shortId(b.head) : "No commits yet"}
                        </p>
                      </div>
                      {b.name === branch && (
                        <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
              <form
                className="flex flex-wrap items-center gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const d = new FormData(e.currentTarget);
                  mutation.mutate({
                    action: "commit",
                    body: {
                      message: d.get("message"),
                      expectedHead: head,
                      requestId: crypto.randomUUID(),
                    },
                  });
                }}
              >
                <Input
                  className="min-w-0 flex-1 basis-56"
                  aria-label="Commit message"
                  name="message"
                  placeholder="Describe this checkpoint"
                  required
                  maxLength={500}
                />
                <Button type="submit" disabled={mutation.isPending || query.isFetching}>
                  Create checkpoint
                </Button>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle as="h2">Commit history</CardTitle>
              <CardDescription>
                Every change creates an immutable commit. Restore adds a new commit and synchronizes
                the entire selected tree.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6">
              {!query.data.commits.length && (
                <p className="leading-6 text-muted-foreground">
                  No commits on this branch. A fork initially points to its source commit; create a
                  checkpoint to start its own history.
                </p>
              )}
              <ol className="empty:hidden">
                {query.data.commits.map((commit: any, index: number) => (
                  <li key={commit.id} className="relative grid gap-3 pb-8 pl-8 last:pb-0">
                    {index < query.data.commits.length - 1 && (
                      <span
                        aria-hidden="true"
                        className="absolute bottom-0 left-[7px] top-2 w-px bg-border"
                      />
                    )}
                    <span
                      aria-hidden="true"
                      className={
                        "absolute left-0 top-1 size-[15px] rounded-full border-2 bg-background " +
                        (commit.id === head ? "border-primary" : "border-border-strong")
                      }
                    />
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <h3 className="min-w-0 break-words font-medium">{commit.message}</h3>
                      <time className="text-xs text-muted-foreground">
                        {new Date(commit.createdAt).toLocaleString()}
                      </time>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
                      <code className="font-mono text-xs text-foreground" title={commit.id}>
                        {shortId(commit.id)}
                      </code>
                      <span>
                        Parent ·{" "}
                        {commit.parent ? (
                          <code className="font-mono text-xs" title={commit.parent}>
                            {shortId(commit.parent)}
                          </code>
                        ) : (
                          "Root commit"
                        )}
                      </span>
                      {commit.id === head && (
                        <AnimatedBadge size="sm" status="info" showIcon={false}>
                          HEAD
                        </AnimatedBadge>
                      )}
                      <AnimatedBadge size="sm" status={commit.projected ? "success" : "neutral"}>
                        {commit.projected ? "Time-series recorded" : "Time-series pending"}
                      </AnimatedBadge>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <form
                        className="flex min-w-0 flex-1 basis-72 items-center gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          mutation.mutate({
                            action: "fork",
                            body: {
                              commitId: commit.id,
                              name: new FormData(e.currentTarget).get("name"),
                            },
                          });
                        }}
                      >
                        <Input
                          className="min-w-0 flex-1"
                          classNames={{ field: "h-8", input: "text-sm" }}
                          aria-label={"New branch from " + commit.id}
                          name="name"
                          required
                          maxLength={80}
                          placeholder="feature/new-experience"
                          leftIcon={<GitFork />}
                        />
                        <Button
                          type="submit"
                          size="sm"
                          variant="outline"
                          disabled={mutation.isPending}
                        >
                          Fork branch
                        </Button>
                      </form>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={mutation.isPending}
                        onClick={() => setRestore({ commit, expectedHead: head })}
                      >
                        <History className="size-3.5" aria-hidden="true" />
                        Restore tree
                      </Button>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="border-t pt-4 text-xs text-muted-foreground">
                Latest 50 commits on this branch. The API supports cursor pagination.{" "}
                {query.data.timeline.length} recent entries in the time-series projection.
              </p>
            </CardContent>
          </Card>
        </>
      )}
      <CenterMorphModal open={!!restore} onOpenChange={closeRestore}>
        <CenterMorphModalContent
          ariaLabel="Restore the entire branch?"
          ariaDescribedBy={restoreDescription}
          className="bg-card"
        >
          <div className="grid gap-4 p-6">
            <h2 className="pr-10 text-lg font-semibold tracking-tight">
              Restore the entire branch?
            </h2>
            <p id={restoreDescription} className="text-sm leading-6 text-muted-foreground">
              Keys absent from this snapshot will be removed. The current history is retained. If
              the branch changes meanwhile, the server rejects this restore.
            </p>
            <p className="break-all rounded-xl bg-muted p-3 text-sm">{restore?.commit.message}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setRestore(null)}>
                Cancel
              </Button>
              <Button
                disabled={mutation.isPending}
                onClick={() =>
                  mutation.mutate({
                    action: "restore",
                    body: {
                      commitId: restore.commit.id,
                      message: "Restore: " + restore.commit.message.slice(0, 490),
                      expectedHead: restore.expectedHead,
                      requestId: crypto.randomUUID(),
                    },
                  })
                }
              >
                Restore snapshot
              </Button>
            </div>
          </div>
        </CenterMorphModalContent>
      </CenterMorphModal>
    </div>
  );
}
