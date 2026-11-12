import { Injectable } from "@nestjs/common";
import { ResourceTemplate, Tool, type McpContext } from "@nestjs/mcp";
import * as z from "zod";
import { VersioningService } from "../sync-storage/services/versioning.service";
import { json, McpAccess, requestId, who } from "./mcp-access";
import { decoded } from "./storage.mcp";
import { TOON_MIME_TYPE } from "./toon.interceptor";

type Target = { userId?: string; branch?: string };

const commitId = z.string().min(1).max(200).describe("A commit ID from list-commits.");
const message = z
  .string()
  .min(1)
  .max(500)
  .describe(
    "Why this commit exists, in 1–500 characters, such as Before importing the new catalog.",
  );
const expectedHead = z
  .string()
  .min(1)
  .nullable()
  .describe(
    "The branch's current head commit ID, from list-branches. null when the branch has no commit yet. The call is refused if the branch moved since, so a concurrent commit is never skipped.",
  );

/** Branches and commits: immutable snapshots of every key a user has on a branch. */
@Injectable()
export class VersioningMcp {
  constructor(
    private readonly access: McpAccess,
    private readonly versions: VersioningService,
  ) {}

  private authorize(ctx: McpContext, method: "GET" | "POST", path: string, target: Target) {
    return this.access.authorize(ctx, { method, path: "versioning/" + path }, target);
  }

  @Tool({
    name: "list-branches",
    title: "List a user's branches",
    description:
      "List every data branch of a user with its head commit ID. main always exists; its head is null until the first commit. Needs a key without prefix restrictions.",
    inputSchema: z.object({ userId: who.userId }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  })
  async listBranches(target: Target, ctx: McpContext) {
    const identity = await this.authorize(ctx, "GET", "branches", target);
    const rows = await this.versions.branches(identity.userId);
    return {
      branches: rows.map((row: any) =>
        json({ name: row.name, head: row.head ?? null, createdAt: row.createdAt ?? null }),
      ),
    };
  }

  @Tool({
    name: "list-commits",
    title: "List the commits of a branch",
    description:
      "List the commits of one branch, newest first, without their contents. Returns up to 50 commits; when nextBefore is not null, pass it as before to get older ones. Use get-commit to see which keys a commit contains.",
    inputSchema: z.object({
      before: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe("The nextBefore value of the previous page."),
      ...who,
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  })
  async listCommits({ before, ...target }: Target & { before?: string }, ctx: McpContext) {
    const identity = await this.authorize(ctx, "GET", "commits", target);
    const rows: any[] = await this.versions.commits(identity.userId, before);
    return {
      returned: rows.length,
      // The service pages by 50: a full page may be followed by older commits.
      nextBefore: rows.length === 50 ? rows[rows.length - 1].id : null,
      commits: json(rows),
    };
  }

  @Tool({
    name: "get-commit",
    title: "Get one commit",
    description:
      "Read one commit of a user: its branch, parent, message, time and tree. The tree maps every key in the snapshot to the ID of its stored content; it does not contain the values themselves.",
    inputSchema: z.object({ commitId, userId: who.userId }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  })
  async getCommit({ commitId, ...target }: Target & { commitId: string }, ctx: McpContext) {
    const identity = await this.authorize(
      ctx,
      "GET",
      "commits/" + encodeURIComponent(commitId),
      target,
    );
    return this.publicCommit(await this.versions.commit(identity.userId, commitId));
  }

  @Tool({
    name: "get-commit-timeline",
    title: "Get the recent commit timeline of a branch",
    description:
      "Read the projected timeline of a branch's 50 most recent commits. The projection runs a few seconds behind: a commit made just now may be missing here while list-commits already shows it.",
    inputSchema: z.object({ ...who }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  })
  async getCommitTimeline(target: Target, ctx: McpContext) {
    const identity = await this.authorize(ctx, "GET", "timeline", target);
    const rows = await this.versions.timeline(identity.userId);
    return {
      entries: rows.map((row: any) =>
        json({
          commitId: row._id,
          at: row.at,
          parent: row.parent ?? null,
          message: row.message ?? null,
        }),
      ),
    };
  }

  @Tool({
    name: "create-commit",
    title: "Commit the current state of a branch",
    description:
      "Save an immutable snapshot of every key a user currently has on a branch. It does not change any stored value. Needs a key with write permission and no prefix restrictions.",
    inputSchema: z.object({ message, expectedHead, requestId, ...who }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  })
  async createCommit(
    {
      message,
      expectedHead,
      requestId,
      ...target
    }: Target & { message: string; expectedHead: string | null; requestId?: string },
    ctx: McpContext,
  ) {
    const identity = await this.authorize(ctx, "POST", "commits", target);
    return json(
      await this.versions.checkpoint(identity.userId, { message, expectedHead }, requestId),
    );
  }

  @Tool({
    name: "create-branch",
    title: "Create a branch from a commit",
    description:
      "Create a new branch of a user's data that starts with the exact contents of one commit. The source branch is not changed. The call fails if a branch with this name exists. Needs a key with write permission and no prefix restrictions.",
    inputSchema: z.object({
      name: z
        .string()
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,79}$/)
        .describe(
          "The new branch's name, such as drafts or experiment/pricing: letters, digits, dots, underscores, hyphens and single slashes. Not main.",
        ),
      commitId: commitId.describe("The commit the new branch starts from, from list-commits."),
      userId: who.userId,
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  })
  async createBranch(
    { name, commitId, ...target }: Target & { name: string; commitId: string },
    ctx: McpContext,
  ) {
    const identity = await this.authorize(ctx, "POST", "branches", target);
    return json(await this.versions.fork(identity.userId, { name, commitId }));
  }

  @Tool({
    name: "restore-commit",
    title: "Restore a branch to a commit",
    description:
      "Replace EVERY key of a branch with the contents of one commit: keys that are not in the commit are deleted, and the user's connected devices are notified. The restore is recorded as a new commit, so it can itself be undone. Ask the user to confirm before calling it. Needs a key with write permission and no prefix restrictions.",
    inputSchema: z.object({ commitId, message, expectedHead, requestId, ...who }),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  })
  async restoreCommit(
    {
      commitId,
      message,
      expectedHead,
      requestId,
      ...target
    }: Target & {
      commitId: string;
      message: string;
      expectedHead: string | null;
      requestId?: string;
    },
    ctx: McpContext,
  ) {
    const identity = await this.authorize(
      ctx,
      "POST",
      `commits/${encodeURIComponent(commitId)}/restore`,
      target,
    );
    return json(
      await this.versions.restore(identity.userId, commitId, { message, expectedHead }, requestId),
    );
  }

  @ResourceTemplate({
    uriTemplate: "sync-store://commits/{commitId}",
    name: "commit",
    title: "A commit",
    description:
      "One commit of the user in the x-user-id request header, as TOON (or JSON when that is smaller): branch, parent, message, time and the keys in its snapshot.",
    mimeType: TOON_MIME_TYPE,
  })
  async commitResource({ commitId }: { commitId: string }, ctx: McpContext) {
    const id = decoded(commitId);
    const identity = await this.authorize(ctx, "GET", "commits/" + encodeURIComponent(id), {});
    return this.publicCommit(await this.versions.commit(identity.userId, id));
  }

  /** The owner field is the internal storage identity; a client has no use for it. */
  private publicCommit(commit: any) {
    return json({
      id: commit.id,
      branch: commit.branch,
      parent: commit.parent ?? null,
      message: commit.message,
      createdAt: commit.createdAt,
      keyCount: Object.keys(commit.tree ?? {}).length,
      tree: commit.tree ?? {},
    });
  }
}
