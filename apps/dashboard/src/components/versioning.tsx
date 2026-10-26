import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Button } from "./ui/button";
import { NativeSelect } from "./ui/native-select";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";

type Scope = { userId: string; projectId: string; tenantId: string; branch: string };
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
  return (
    <div className="grid min-w-0 gap-5">
      {!scope && (
        <Card className="p-7 text-sm text-muted-foreground">
          Choose a user in Data scope above to inspect their branches and immutable commit history.
        </Card>
      )}
      {(query.error || mutation.error) && (
        <p
          role="alert"
          className="break-words rounded-xl bg-destructive/10 p-4 text-sm text-destructive"
        >
          {query.error?.message || mutation.error?.message}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      {query.isFetching && <p role="status">Loading branch history…</p>}
      {scope && query.data && (
        <>
          <Card className="grid gap-5 p-5 sm:p-7">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <Label className="grid gap-2">
                Current branch
                <NativeSelect
                  value={branch}
                  onChange={(e) => {
                    setBranch(e.target.value);
                    onBranchChange?.(e.target.value);
                    setRestore(null);
                    mutation.reset();
                  }}
                >
                  {query.data.branches.map((b: any) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </NativeSelect>
              </Label>
              <Button variant="outline" onClick={() => void query.refetch()}>
                Refresh
              </Button>
            </div>
            <p className="break-all text-xs text-muted-foreground">
              HEAD · {head || "No commits yet"}
            </p>
            <form
              className="flex flex-wrap gap-3"
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
          </Card>
          <Card className="gap-0 overflow-hidden">
            <div className="border-b p-5 sm:p-7">
              <h2 className="font-semibold">Commit history</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Every change creates an immutable commit. Restore adds a new commit and synchronizes
                the entire selected tree.
              </p>
            </div>
            {!query.data.commits.length && (
              <p className="p-7 text-sm text-muted-foreground">
                No commits on this branch. A fork initially points to its source commit; create a
                checkpoint to start its own history.
              </p>
            )}
            {query.data.commits.map((commit: any) => (
              <article key={commit.id} className="grid gap-3 border-b p-5 last:border-0 sm:p-7">
                <div className="flex flex-wrap justify-between gap-3">
                  <h3 className="break-words font-medium">{commit.message}</h3>
                  <time className="text-xs text-muted-foreground">
                    {new Date(commit.createdAt).toLocaleString()}
                  </time>
                </div>
                <p className="break-all font-mono text-xs text-muted-foreground">
                  {commit.id}
                  <br />
                  Parent · {commit.parent || "Root commit"}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {commit.projected ? "Time-series recorded" : "Time-series pending"}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={mutation.isPending}
                    onClick={() => setRestore({ commit, expectedHead: head })}
                  >
                    Restore tree
                  </Button>
                </div>
                <form
                  className="flex flex-wrap gap-2"
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
                    className="min-w-0 flex-1 basis-48"
                    aria-label={"New branch from " + commit.id}
                    name="name"
                    required
                    maxLength={80}
                    placeholder="feature/new-experience"
                  />
                  <Button type="submit" size="sm" variant="outline" disabled={mutation.isPending}>
                    Fork branch
                  </Button>
                </form>
              </article>
            ))}
            <p className="p-5 text-xs text-muted-foreground">
              Latest 50 commits on this branch. The API supports cursor pagination.{" "}
              {query.data.timeline.length} recent entries in the time-series projection.
            </p>
          </Card>
        </>
      )}
      <Dialog
        open={!!restore}
        onOpenChange={(open) => {
          if (!open) setRestore(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Restore the entire branch?</DialogTitle>
          <DialogDescription>
            Keys absent from this snapshot will be removed. The current history is retained. If the
            branch changes meanwhile, the server rejects this restore.
          </DialogDescription>
          <p className="break-all text-sm">{restore?.commit.message}</p>
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
        </DialogContent>
      </Dialog>
    </div>
  );
}
