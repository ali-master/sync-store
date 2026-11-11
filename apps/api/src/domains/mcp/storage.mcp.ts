import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { Resource, ResourceTemplate, Tool, type McpContext } from "@nestjs/mcp";
import * as z from "zod";
import { ClearStorageCommand } from "../sync-storage/commands/impl/clear-storage.command";
import { RemoveItemCommand } from "../sync-storage/commands/impl/remove-item.command";
import { SetItemCommand } from "../sync-storage/commands/impl/set-item.command";
import { GetAllItemsQuery } from "../sync-storage/queries/impl/get-all-items.query";
import { GetItemQuery } from "../sync-storage/queries/impl/get-item.query";
import { GetKeysQuery } from "../sync-storage/queries/impl/get-keys.query";
import { SyncStorageRepository } from "../sync-storage/repositories/sync-storage.repository";
import { permits, versionScope } from "../sync-storage/services/access-policy";
import { json, McpAccess, page, paging, publicItem, requestId, who } from "./mcp-access";

const key = z
  .string()
  .min(1)
  .max(500)
  .describe("The exact, case-sensitive storage key, such as preferences or cart/items.");
const prefix = z
  .string()
  .min(1)
  .max(500)
  .optional()
  .describe("Return only keys that start with this literal, case-sensitive text, such as cart/.");
const item = z.record(z.string(), z.unknown());
const revision = z
  .string()
  .min(1)
  .max(500)
  .describe("A revision ID from list-item-history, such as 6f1c…:3.");

/** URI template variables arrive percent-encoded; a stray % must not fail the read. */
export function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** History stores values as JSON text; return them parsed, as the item tools do. */
function parsed(text: unknown) {
  if (typeof text !== "string") return text ?? null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function publicRevision(row: any) {
  return json({
    revision: row._id,
    version: row.version,
    isDeleted: Boolean(row.isDeleted),
    value: parsed(row.value),
    metadata: parsed(row.metadata),
    lastModified: row.lastModified,
    writtenByInstance: row.instanceId ?? null,
    retainedUntil: row.expiresAt ?? null,
  });
}

export const GUIDE = `# Sync Store over MCP

Sync Store keeps JSON values per user and synchronizes them to that user's connected devices.

## Whose data a call uses
- Every data tool acts for one user. Pass \`userId\`, or configure the \`x-user-id\` request header once in the MCP client.
- A user's data lives on a branch. \`main\` is the default; pass \`branch\` or the \`x-branch\` header for another one.
- The API key decides the project and tenant. A key cannot reach another project's or tenant's data.
- Call \`describe-access\` first to see what the key may do.

## Reading
- \`list-keys\` and \`list-items\` are paged: when \`nextOffset\` is not null, there is more.
- \`get-item\` returns \`found: false\` for a key that does not exist. Never invent a value.

## Writing
- \`set-item\` replaces the whole value of a key and notifies the user's connected devices.
- Read the current value first when you change part of an object, then write the complete new object.
- Earlier values are retained for a limited time: see \`list-item-history\`.
- To undo, preview a revision with \`preview-item-revision\`, then call \`restore-item-revision\` with the \`expected\` value from that preview.

## Branches and commits
- A commit is an immutable snapshot of every key on a branch. \`create-commit\` and \`restore-commit\` need \`expectedHead\`: the branch's \`head\` from \`list-branches\`, or null for a branch without commits.

## Administration
- Tools whose names start with \`admin-\` need an administrator key. With any other key they answer "Required API key scope: admin".
`;

/** Item storage and per-key history, with the permissions of the API key that calls them. */
@Injectable()
export class StorageMcp {
  constructor(
    private readonly access: McpAccess,
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
    private readonly repository: SyncStorageRepository,
  ) {}

  @Tool({
    name: "describe-access",
    title: "Describe this API key's access",
    description:
      "Report what the calling API key may do: read or write permission, its project, the key prefixes it is limited to, whether it is an administrator key, and the default user and branch taken from the request headers. Call it first when you are unsure whether an action is allowed.",
    inputSchema: z.object({}),
    outputSchema: z.object({
      keyName: z.string(),
      canRead: z.boolean(),
      canWrite: z.boolean(),
      isAdministrator: z.boolean(),
      tenantId: z.string().nullable(),
      projectId: z.string(),
      readPrefixes: z.array(z.string()),
      writePrefixes: z.array(z.string()),
      expiresAt: z.string().nullable(),
      defaultUserId: z.string().nullable(),
      defaultBranch: z.string(),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  })
  async describeAccess(_input: unknown, ctx: McpContext) {
    const identity = await this.access.authorize(ctx, {
      method: "GET",
      path: "mcp",
      anonymous: true,
    });
    const record = identity.apiKey as Record<string, any>;
    const headers = ctx.request?.headers ?? {};
    const scopes = JSON.parse(record.scopes || "[]");
    return {
      keyName: String(record.name ?? ""),
      canRead: Boolean(record.canRead),
      canWrite: Boolean(record.canWrite),
      isAdministrator: Array.isArray(scopes) && (scopes.includes("admin") || scopes.includes("*")),
      tenantId: record.tenantId ?? null,
      projectId: identity.access.projectId,
      readPrefixes: identity.access.readPrefixes,
      writePrefixes: identity.access.writePrefixes,
      expiresAt: record.expiresAt ? new Date(record.expiresAt).toISOString() : null,
      defaultUserId: typeof headers["x-user-id"] === "string" ? headers["x-user-id"] : null,
      defaultBranch: typeof headers["x-branch"] === "string" ? headers["x-branch"] : "main",
    };
  }

  @Tool({
    name: "get-item",
    title: "Get a stored item",
    description:
      "Read the value stored under one exact key for a user. Returns found=false and item=null when the key does not exist or was deleted. Use list-keys first when you do not know the exact key.",
    inputSchema: z.object({ key, ...who }),
    outputSchema: z.object({ found: z.boolean(), item: item.nullable() }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  })
  async getItem(
    { key, ...target }: { key: string; userId?: string; branch?: string },
    ctx: McpContext,
  ) {
    const identity = await this.access.authorize(
      ctx,
      { method: "GET", path: "item/" + encodeURIComponent(key), key },
      target,
    );
    const found = await this.queries.execute(
      new GetItemQuery(identity.userId, identity.instanceId, key),
    );
    return { found: Boolean(found), item: found ? publicItem(found) : null };
  }

  @Tool({
    name: "list-keys",
    title: "List stored keys",
    description:
      "List the keys a user has stored, in alphabetical order, without their values. The result is paged: total is the number of matching keys, and nextOffset is null on the last page. Only keys this API key may read are listed.",
    inputSchema: z.object({ prefix, ...paging, ...who }),
    outputSchema: z.object({
      total: z.number(),
      offset: z.number(),
      returned: z.number(),
      nextOffset: z.number().nullable(),
      items: z.array(z.string()),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  })
  async listKeys(
    {
      prefix,
      offset = 0,
      limit = 50,
      ...target
    }: { prefix?: string; offset?: number; limit?: number; userId?: string; branch?: string },
    ctx: McpContext,
  ) {
    const identity = await this.access.authorize(ctx, { method: "GET", path: "keys" }, target);
    const keys: string[] = await this.queries.execute(
      new GetKeysQuery(identity.userId, identity.instanceId, prefix),
    );
    return page(
      keys.filter((name) => permits(identity.access, name, true)),
      offset,
      limit,
    );
  }

  @Tool({
    name: "list-items",
    title: "List stored items",
    description:
      "List a user's stored items with their values, most recently changed first. The result is paged: total is the number of matching items, and nextOffset is null on the last page. Values can be large; prefer list-keys followed by get-item when you need only a few.",
    inputSchema: z.object({
      prefix,
      offset: paging.offset,
      limit: z.number().int().min(1).max(100).default(20).describe("How many items to return."),
      ...who,
    }),
    outputSchema: z.object({
      total: z.number(),
      offset: z.number(),
      returned: z.number(),
      nextOffset: z.number().nullable(),
      items: z.array(item),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  })
  async listItems(
    {
      prefix,
      offset = 0,
      limit = 20,
      ...target
    }: { prefix?: string; offset?: number; limit?: number; userId?: string; branch?: string },
    ctx: McpContext,
  ) {
    const identity = await this.access.authorize(ctx, { method: "GET", path: "items" }, target);
    const items: any[] = await this.queries.execute(
      new GetAllItemsQuery(identity.userId, identity.instanceId, prefix),
    );
    // ponytail: pages an in-memory list, as REST loads it; page in the query if stores grow large.
    const result = page(
      items.filter((entry) => permits(identity.access, entry.key, true)),
      offset,
      limit,
    );
    return { ...result, items: result.items.map(publicItem) };
  }

  @Tool({
    name: "set-item",
    title: "Store an item",
    description:
      "Create a key or replace its whole value for a user, and notify that user's connected devices. This overwrites the previous value; the previous value stays in list-item-history for a limited time. To change part of an object, read it with get-item and write the complete new object. Returns the item as stored, with its new version. Needs a key with write permission.",
    inputSchema: z.object({
      key,
      value: z
        .unknown()
        .describe(
          'The complete new value: any JSON value, such as {"theme":"dark"}, [1,2], "text", 3, true or null.',
        ),
      metadata: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Optional JSON object stored next to the value, such as {"source":"assistant"}.'),
      requestId,
      ...who,
    }),
    outputSchema: z.object({ item }),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  })
  async setItem(
    {
      key,
      value,
      metadata,
      requestId,
      ...target
    }: {
      key: string;
      value?: unknown;
      metadata?: Record<string, unknown>;
      requestId?: string;
      userId?: string;
      branch?: string;
    },
    ctx: McpContext,
  ) {
    if (value === undefined)
      throw new BadRequestException("value is required; pass null to store a JSON null");
    const identity = await this.access.authorize(
      ctx,
      { method: "PUT", path: "item/" + encodeURIComponent(key), key },
      target,
    );
    const stored = await this.commands.execute(
      new SetItemCommand(identity.userId, identity.instanceId, key, value, metadata, requestId),
    );
    return { item: publicItem(stored) };
  }

  @Tool({
    name: "remove-item",
    title: "Remove an item",
    description:
      "Delete one key for a user and notify that user's connected devices. existed tells whether the key held a value just before the call; removing a missing key changes nothing. The removed value stays in list-item-history for a limited time. Needs a key with write permission.",
    inputSchema: z.object({ key, requestId, ...who }),
    outputSchema: z.object({ key: z.string(), existed: z.boolean() }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  })
  async removeItem(
    {
      key,
      requestId,
      ...target
    }: { key: string; requestId?: string; userId?: string; branch?: string },
    ctx: McpContext,
  ) {
    const identity = await this.access.authorize(
      ctx,
      { method: "DELETE", path: "item/" + encodeURIComponent(key), key },
      target,
    );
    const existed = Boolean(await this.repository.findByKey(identity.userId, key));
    await this.commands.execute(
      new RemoveItemCommand(identity.userId, identity.instanceId, key, requestId),
    );
    return { key, existed };
  }

  @Tool({
    name: "clear-storage",
    title: "Remove every item of a user",
    description:
      "Delete ALL keys of one user on one branch and notify that user's connected devices. This cannot be limited to a prefix. itemsBefore is the number of keys that existed just before the call. Ask the user to confirm before calling it. Needs a key with unrestricted write permission.",
    inputSchema: z.object({ requestId, ...who }),
    outputSchema: z.object({ itemsBefore: z.number() }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  })
  async clearStorage(
    { requestId, ...target }: { requestId?: string; userId?: string; branch?: string },
    ctx: McpContext,
  ) {
    const identity = await this.access.authorize(ctx, { method: "DELETE", path: "clear" }, target);
    const itemsBefore = await this.repository.count(identity.userId);
    await this.commands.execute(
      new ClearStorageCommand(identity.userId, identity.instanceId, requestId),
    );
    return { itemsBefore };
  }

  @Tool({
    name: "list-item-history",
    title: "List earlier versions of an item",
    description:
      "List the retained versions of one key, newest first, including the versions that deleted it (isDeleted=true). Returns up to 50 revisions; when nextBefore is not null, pass it as before to get older ones. Versions older than the server's retention period are gone.",
    inputSchema: z.object({
      key,
      before: z
        .string()
        .min(1)
        .max(500)
        .optional()
        .describe("The nextBefore value of the previous page."),
      ...who,
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  })
  async listItemHistory(
    { key, before, ...target }: { key: string; before?: string; userId?: string; branch?: string },
    ctx: McpContext,
  ) {
    const identity = await this.access.authorize(
      ctx,
      { method: "GET", path: "history/" + encodeURIComponent(key), key },
      target,
    );
    const rows = await this.repository.history(identity.userId, key, before);
    return {
      key,
      returned: rows.length,
      // The repository pages by 50: a full page may be followed by older revisions.
      nextBefore: rows.length === 50 ? rows[rows.length - 1]._id : null,
      revisions: rows.map(publicRevision),
    };
  }

  @Tool({
    name: "preview-item-revision",
    title: "Preview an earlier version of an item",
    description:
      "Show one retained revision of a key next to the key's current value, without changing anything. The result's expected field is what restore-item-revision needs to restore this revision safely.",
    inputSchema: z.object({ key, revision, ...who }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  })
  async previewItemRevision(
    {
      key,
      revision,
      ...target
    }: { key: string; revision: string; userId?: string; branch?: string },
    ctx: McpContext,
  ) {
    const identity = await this.access.authorize(
      ctx,
      {
        method: "GET",
        path: `history/${encodeURIComponent(key)}/${encodeURIComponent(revision)}`,
        key,
      },
      target,
    );
    const { snapshot, current } = await this.repository.preview(identity.userId, key, revision);
    return {
      key,
      revision: publicRevision(snapshot),
      current: current
        ? json({
            version: Number(current.version),
            isDeleted: Boolean(current.isDeleted),
            value: parsed(current.value),
            metadata: parsed(current.metadata),
          })
        : null,
      expected: current ? { id: String(current.id), version: Number(current.version) } : null,
    };
  }

  @Tool({
    name: "restore-item-revision",
    title: "Restore an earlier version of an item",
    description:
      "Make a retained revision the current value of a key, as a new version, and notify the user's connected devices. Call preview-item-revision first and pass its expected field: the restore is refused if the item changed since that preview, so a newer edit is never overwritten. Restoring a revision with isDeleted=true deletes the key. Needs a key with write permission.",
    inputSchema: z.object({
      key,
      revision,
      expected: z
        .object({ id: z.string(), version: z.number().int() })
        .nullable()
        .describe(
          "The expected field returned by preview-item-revision, unchanged. null when that preview showed no current item.",
        ),
      requestId,
      ...who,
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  })
  async restoreItemRevision(
    {
      key,
      revision,
      expected,
      requestId,
      ...target
    }: {
      key: string;
      revision: string;
      expected: { id: string; version: number } | null;
      requestId?: string;
      userId?: string;
      branch?: string;
    },
    ctx: McpContext,
  ) {
    const identity = await this.access.authorize(
      ctx,
      {
        method: "POST",
        path: `history/${encodeURIComponent(key)}/${encodeURIComponent(revision)}/restore`,
        key,
      },
      target,
    );
    const result: any = await this.repository.restore(
      identity.userId,
      identity.instanceId,
      key,
      revision,
      expected,
      requestId,
    );
    return {
      restored: true,
      isDeleted: Boolean(result.isDeleted),
      item: result.item ? publicItem(result.item) : null,
    };
  }

  @Resource({
    uri: "sync-store://guide",
    name: "guide",
    title: "How to use Sync Store over MCP",
    description:
      "How users, branches, keys, history and administrator tools work on this server. Read it before working with stored data.",
    mimeType: "text/markdown",
  })
  guide() {
    return GUIDE;
  }

  @ResourceTemplate({
    uriTemplate: "sync-store://items/{+key}",
    name: "item",
    title: "A stored item",
    description:
      "The current value of one key, as JSON, for the user in the x-user-id request header and the branch in x-branch (default main).",
    mimeType: "application/json",
  })
  async itemResource({ key }: { key: string }, ctx: McpContext) {
    const name = decoded(key);
    const identity = await this.access.authorize(ctx, {
      method: "GET",
      path: "item/" + encodeURIComponent(name),
      key: name,
    });
    const found = await this.queries.execute(
      new GetItemQuery(identity.userId, identity.instanceId, name),
    );
    if (!found) throw new NotFoundException("No item is stored under this key");
    return publicItem(found);
  }

  @ResourceTemplate({
    uriTemplate: "sync-store://keys/{userId}",
    name: "keys",
    title: "A user's stored keys",
    description:
      "Every key one user has stored on the branch in x-branch (default main), as a JSON array in alphabetical order.",
    mimeType: "application/json",
  })
  async keysResource({ userId }: { userId: string }, ctx: McpContext) {
    const identity = await this.access.authorize(
      ctx,
      { method: "GET", path: "keys" },
      { userId: decoded(userId) },
    );
    const keys: string[] = await this.queries.execute(
      new GetKeysQuery(identity.userId, identity.instanceId),
    );
    return {
      userId: decoded(userId),
      branch: versionScope(identity.userId).branch,
      keys: keys.filter((name) => permits(identity.access, name, true)),
    };
  }
}
