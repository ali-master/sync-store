import { BadRequestException, Injectable } from "@nestjs/common";
import { Tool, type McpContext } from "@nestjs/mcp";
import * as z from "zod";
import { AdminService, resources } from "../admin/admin.service";
import { OperationsService } from "../analytics/operations.service";
import { VersioningService } from "../sync-storage/services/versioning.service";
import { json, McpAccess, publicItem } from "./mcp-access";

const ADMIN = "Needs an administrator key.";
const read = { readOnlyHint: true, openWorldHint: false } as const;
const change = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const destroy = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

/** Resources whose records belong to one application user, and so can be filtered by one. */
const userScoped = ["storage", "history", "sessions", "conflicts", "audits", "archives", "quotas"];

const storageUser = z
  .string()
  .min(1)
  .max(500)
  .describe(
    "The record's userId exactly as admin-list-records shows it, such as user_42 or tenant:acme:user_42.",
  );

/** Where an application user's data lives: the same choice the dashboard's scope bar makes. */
const scope = {
  projectId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,80}$/)
    .optional()
    .describe(
      "The project's ID, from admin-list-records with resource=projects. Default: default.",
    ),
  tenantId: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe(
      "The tenant's ID, from admin-list-records with resource=tenants. Platform administrators only. Default: the default tenant.",
    ),
  branch: z.string().min(1).max(80).optional().describe("The data branch. Default: main."),
};

const quota = z.number().int().min(1).max(2147483647).nullable().optional();
const patterns = z.array(z.string().min(1).max(250)).max(100).optional();
const keySettings = {
  description: z.string().max(250).optional().describe("A note for other administrators."),
  canRead: z
    .boolean()
    .optional()
    .describe("Allow reading stored data. Default for new keys: true."),
  canWrite: z
    .boolean()
    .optional()
    .describe("Allow changing stored data. Default for new keys: false."),
  isActive: z.boolean().optional().describe("false blocks every request made with the key."),
  requireHttps: z.boolean().optional().describe("Refuse requests that did not arrive over HTTPS."),
  minuteQuota: quota.describe("Requests allowed per minute; null for no limit."),
  hourQuota: quota.describe("Requests allowed per hour; null for no limit."),
  dailyQuota: quota.describe("Requests allowed per UTC day; null for no limit."),
  monthlyQuota: quota.describe("Requests allowed per UTC month; null for no limit."),
  allowedMethods: z
    .array(z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]))
    .max(7)
    .optional()
    .describe(
      "HTTP methods the key may use. Over MCP, reads count as GET, set-item as PUT, removals as DELETE.",
    ),
  ipRestrictions: patterns.describe("IP addresses or CIDR ranges, such as 203.0.113.0/24."),
  restrictionMode: z
    .enum(["allow", "deny"])
    .optional()
    .describe("Whether ipRestrictions lists the allowed addresses or the blocked ones."),
  websiteOrigins: patterns.describe(
    "Website hostnames the key may be used from, such as app.example.com. A key with this restriction cannot be used by server-side or MCP clients, which send no Origin.",
  ),
  allowedUserAgents: patterns.describe("User-Agent patterns to allow; * is a wildcard."),
  blockedUserAgents: patterns.describe("User-Agent patterns to refuse; * is a wildcard."),
  expiresAt: z.iso
    .datetime({ offset: true })
    .nullable()
    .optional()
    .describe("When the key stops working, such as 2027-01-01T00:00:00Z; null for never."),
  access: z
    .object({
      projectId: z
        .string()
        .regex(/^[a-zA-Z0-9_-]{1,80}$/)
        .describe("The project the key is bound to; default for the default project."),
      readPrefixes: z
        .array(z.string().min(1).max(250))
        .max(100)
        .describe("Key prefixes the key may read, such as cart/. Empty for every key."),
      writePrefixes: z
        .array(z.string().min(1).max(250))
        .max(100)
        .describe("Key prefixes the key may write. Empty for every key."),
    })
    .optional()
    .describe("The key's project and prefix limits. A key's project cannot be changed later."),
};

/** Leave out what the caller did not send, so a missing field is never read as a new value. */
function sent<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/** Installation administration: the operations of the dashboard, for an administrator key. */
@Injectable()
export class AdminMcp {
  constructor(
    private readonly access: McpAccess,
    private readonly admin: AdminService,
    private readonly operations: OperationsService,
    private readonly versions: VersioningService,
  ) {}

  /** Returns the administrator key's ID, the actor of every audit entry. */
  private async actor(ctx: McpContext, method: "GET" | "POST" | "PATCH", path: string) {
    const identity = await this.access.authorize(ctx, {
      method,
      path: "admin/" + path,
      scope: "admin",
    });
    return identity.apiKey.id;
  }

  @Tool({
    name: "admin-overview",
    title: "Installation overview",
    description: `Read live counts of the installation: records per collection, distinct users, stored bytes, connected sessions, API calls, database response time and uptime. A tenant administrator sees only that tenant. These are measurements taken now, not a history. ${ADMIN}`,
    inputSchema: z.object({}),
    annotations: read,
  })
  async overview(_input: unknown, ctx: McpContext) {
    return json(await this.admin.overview(await this.actor(ctx, "GET", "overview")));
  }

  @Tool({
    name: "admin-list-records",
    title: "Browse the installation's records",
    description: `List one kind of record, 25 per page, newest first. total is the number of matching records and hasMore tells whether another page follows. API key secrets are never included. search matches identifying fields (IDs, names, user IDs, keys, actions), not the stored JSON values. ${ADMIN}`,
    inputSchema: z.object({
      resource: z
        .enum(Object.keys(resources) as [keyof typeof resources, ...(keyof typeof resources)[]])
        .describe(
          "storage: stored items. history: retained item versions. keys: API keys. projects. tenants. sessions: live connections. conflicts. audits: administrative actions. quotas: per-user limits. analytics. archives.",
        ),
      page: z.number().int().min(1).max(10000).default(1).describe("The page number, from 1."),
      search: z
        .string()
        .min(1)
        .max(500)
        .optional()
        .describe("Literal, case-insensitive text to find, such as cart or user_42."),
      userId: z
        .string()
        .min(1)
        .max(500)
        .optional()
        .describe(
          "Show only one application user's records, such as user_42. Only for storage, history, sessions, conflicts, audits, archives and quotas.",
        ),
      ...scope,
    }),
    annotations: read,
  })
  async listRecords(
    {
      resource,
      page = 1,
      search,
      userId,
      ...where
    }: {
      resource: string;
      page?: number;
      search?: string;
      userId?: string;
      projectId?: string;
      tenantId?: string;
      branch?: string;
    },
    ctx: McpContext,
  ) {
    if (userId && !userScoped.includes(resource))
      throw new BadRequestException(`userId cannot filter ${resource}; use search instead`);
    if (!userId && Object.values(where).some((value) => value !== undefined))
      throw new BadRequestException(
        "projectId, tenantId and branch apply only together with userId",
      );
    const actor = await this.actor(ctx, "GET", "resources/" + resource);
    const result = await this.admin.list(
      resource,
      sent({
        page: String(page),
        q: search,
        ...(userId ? { scopeUser: userId, ...where } : {}),
      }) as Record<string, string>,
      actor,
    );
    return {
      resource,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      hasMore: result.page * result.pageSize < result.total,
      items: result.items,
    };
  }

  @Tool({
    name: "admin-report",
    title: "Operational report",
    description: `Read a measured time series of the installation. health: published events, publish failures, publish latency and connections. usage: HTTP requests, errors, quota admissions and rejections per project and API key, with quota forecasts. changes: counts of created, updated and deleted items and stored size, never the stored values. Intervals without samples are absent, not zero. Each report also compares with the preceding window of the same length. ${ADMIN}`,
    inputSchema: z.object({
      report: z.enum(["health", "usage", "changes"]),
      hours: z
        .union([z.literal(1), z.literal(24), z.literal(168), z.literal(720)])
        .default(24)
        .describe("The window: 1 hour, 24 hours, 168 (7 days) or 720 (30 days)."),
      end: z.iso
        .datetime({ offset: true })
        .optional()
        .describe(
          "The end of the window, within the past 60 days, such as 2026-11-11T00:00:00Z. Default: now.",
        ),
      project: z.string().min(1).max(128).optional().describe("usage and changes: one project ID."),
      apiKeyId: z.string().min(1).max(128).optional().describe("usage: one API key ID."),
      replica: z.string().min(1).max(128).optional().describe("health: one API replica."),
    }),
    annotations: read,
  })
  async report(
    {
      report,
      hours = 24,
      ...filters
    }: {
      report: "health" | "usage" | "changes";
      hours?: number;
      end?: string;
      project?: string;
      apiKeyId?: string;
      replica?: string;
    },
    ctx: McpContext,
  ) {
    const actor = await this.actor(ctx, "GET", "reports/" + report);
    const query = sent({ hours: String(hours), ...filters }) as Record<string, string>;
    return json(await this.operations[report](query, await this.admin.tenant(actor)));
  }

  @Tool({
    name: "admin-create-key",
    title: "Create an API key",
    description: `Create an application API key. The result's key field is the secret: it is shown only this once, so give it to the user to save and never repeat it elsewhere. New keys can read; set canWrite to let them change data. ${ADMIN}`,
    inputSchema: z.object({
      name: z.string().min(1).max(250).describe("A recognizable name, such as Web app production."),
      ...keySettings,
    }),
    annotations: change,
  })
  async createKey(settings: Record<string, unknown>, ctx: McpContext) {
    const actor = await this.actor(ctx, "POST", "keys");
    return this.admin.createKey(sent(settings), actor);
  }

  @Tool({
    name: "admin-update-key",
    title: "Change an API key's settings",
    description: `Change the name, permissions, quotas or restrictions of an API key. Only the fields you send change. Disabling a key (isActive=false) blocks its next request. The installation administrator key cannot be changed here. ${ADMIN}`,
    inputSchema: z.object({
      keyId: z.string().min(1).max(500).describe("The key's _id, from admin-list-records."),
      name: z.string().min(1).max(250).optional().describe("A new name."),
      ...keySettings,
    }),
    annotations: change,
  })
  async updateKey(
    { keyId, ...settings }: { keyId: string } & Record<string, unknown>,
    ctx: McpContext,
  ) {
    if (Object.keys(sent(settings)).length === 0)
      throw new BadRequestException("Send at least one setting to change");
    const actor = await this.actor(ctx, "PATCH", "keys/" + encodeURIComponent(keyId));
    return { keyId, ...(await this.admin.updateKey(keyId, sent(settings), actor)) };
  }

  @Tool({
    name: "admin-rotate-key",
    title: "Replace an API key's secret",
    description: `Replace the secret of an API key. The old secret stops working immediately, so every application that uses it fails until it is given the new one. The result's key field is the new secret, shown only this once. Rotating the installation administrator key also signs out every dashboard SSO session. Ask the user to confirm before calling it. ${ADMIN}`,
    inputSchema: z.object({
      keyId: z.string().min(1).max(500).describe("The key's _id, from admin-list-records."),
    }),
    annotations: destroy,
  })
  async rotateKey({ keyId }: { keyId: string }, ctx: McpContext) {
    const actor = await this.actor(ctx, "POST", `keys/${encodeURIComponent(keyId)}/rotate`);
    return { keyId, ...(await this.admin.rotateKey(keyId, actor)) };
  }

  @Tool({
    name: "admin-create-project",
    title: "Create a project",
    description: `Create a project: a separate namespace for an application's data. Existing data is not moved. Bind an API key to it with admin-create-key's access.projectId. ${ADMIN}`,
    inputSchema: z.object({
      name: z.string().min(1).max(100).describe("The project's name, such as Mobile app."),
    }),
    annotations: change,
  })
  async createProject({ name }: { name: string }, ctx: McpContext) {
    return json(
      await this.admin.createProject({ name }, await this.actor(ctx, "POST", "projects")),
    );
  }

  @Tool({
    name: "admin-create-tenant",
    title: "Create a tenant",
    description: `Create a customer workspace with its own administrator key, projects, data and reports. The result's key field is the tenant administrator's secret, shown only this once. Needs the platform administrator key; a tenant administrator is refused.`,
    inputSchema: z.object({
      name: z.string().min(1).max(100).describe("The tenant's name, such as Acme Inc."),
    }),
    annotations: change,
  })
  async createTenant({ name }: { name: string }, ctx: McpContext) {
    return json(await this.admin.createTenant({ name }, await this.actor(ctx, "POST", "tenants")));
  }

  @Tool({
    name: "admin-update-tenant",
    title: "Suspend or resume a tenant",
    description: `Suspend (isActive=false) or resume (isActive=true) a tenant. Suspending blocks every API key of the tenant at its next request; the tenant's data is not changed. Needs the platform administrator key.`,
    inputSchema: z.object({
      tenantId: z.string().min(1).max(500).describe("The tenant's _id, from admin-list-records."),
      isActive: z.boolean(),
    }),
    annotations: destroy,
  })
  async updateTenant(
    { tenantId, isActive }: { tenantId: string; isActive: boolean },
    ctx: McpContext,
  ) {
    const actor = await this.actor(ctx, "PATCH", "tenants/" + encodeURIComponent(tenantId));
    return json(await this.admin.updateTenant(tenantId, { isActive }, actor));
  }

  @Tool({
    name: "admin-write-item",
    title: "Store an item for any user",
    description: `Create a key or replace its whole value for any application user, and notify that user's connected devices. The write is recorded in the audit log. Give the application's own user ID with projectId, tenantId or branch to choose where the data lives; without them, userId is the storage identity as admin-list-records shows it. ${ADMIN}`,
    inputSchema: z.object({
      userId: z.string().min(1).max(500).describe("The user's ID, such as user_42."),
      key: z.string().min(1).max(500).describe("The exact storage key, such as preferences."),
      value: z
        .unknown()
        .describe('The complete new value: any JSON value, such as {"theme":"dark"}.'),
      ...scope,
    }),
    annotations: destroy,
  })
  async writeItem(
    {
      userId,
      key,
      value,
      ...where
    }: {
      userId: string;
      key: string;
      value?: unknown;
      projectId?: string;
      tenantId?: string;
      branch?: string;
    },
    ctx: McpContext,
  ) {
    if (value === undefined)
      throw new BadRequestException("value is required; pass null to store a JSON null");
    const actor = await this.actor(ctx, "POST", "storage");
    const selected = sent(where);
    const stored = await this.admin.write(
      { userId, key, value, ...(Object.keys(selected).length ? { scope: selected } : {}) },
      actor,
    );
    return { item: publicItem(stored) };
  }

  @Tool({
    name: "admin-delete-item",
    title: "Delete an item of any user",
    description: `Delete one key of one user and notify that user's connected devices. Deleting a missing key changes nothing. The deletion is recorded in the audit log, and the removed value stays in history for a limited time. ${ADMIN}`,
    inputSchema: z.object({
      userId: storageUser,
      key: z.string().min(1).max(500).describe("The exact storage key."),
    }),
    annotations: { ...destroy, idempotentHint: true },
  })
  async deleteItem({ userId, key }: { userId: string; key: string }, ctx: McpContext) {
    const actor = await this.actor(ctx, "POST", "storage/delete");
    return { userId, key, ...(await this.admin.remove({ userId, key }, actor)) };
  }

  @Tool({
    name: "admin-preview-history",
    title: "Preview a retained version of any user's item",
    description: `Show one retained version of a key next to the key's current value, without changing anything. Find revisions with admin-list-records and resource=history: the revision is the record's _id. The result's expected field is what admin-restore-history needs. ${ADMIN}`,
    inputSchema: z.object({
      userId: storageUser,
      key: z.string().min(1).max(500).describe("The exact storage key."),
      revision: z.string().min(1).max(500).describe("The history record's _id."),
    }),
    annotations: read,
  })
  async previewHistory(body: { userId: string; key: string; revision: string }, ctx: McpContext) {
    const actor = await this.actor(ctx, "POST", "history/preview");
    const { snapshot, current } = await this.admin.previewHistory(body, actor);
    return json({
      snapshot,
      current,
      expected: current ? { id: String(current.id), version: Number(current.version) } : null,
    });
  }

  @Tool({
    name: "admin-restore-history",
    title: "Restore a retained version of any user's item",
    description: `Make a retained version the current value of a key, as a new version, and notify the user's connected devices. Call admin-preview-history first and pass its expected field: the restore is refused if the item changed since that preview. The restore is recorded in the audit log. ${ADMIN}`,
    inputSchema: z.object({
      userId: storageUser,
      key: z.string().min(1).max(500).describe("The exact storage key."),
      revision: z.string().min(1).max(500).describe("The history record's _id."),
      expected: z
        .object({ id: z.string(), version: z.number().int() })
        .nullable()
        .describe("The expected field returned by admin-preview-history, unchanged."),
      requestId: z
        .string()
        .regex(/^[A-Za-z0-9._:-]{1,128}$/)
        .describe(
          "A new unique ID for this restore, such as a UUID. Send the same ID again only to retry the same restore.",
        ),
    }),
    annotations: destroy,
  })
  async restoreHistory(
    body: {
      userId: string;
      key: string;
      revision: string;
      expected: { id: string; version: number } | null;
      requestId: string;
    },
    ctx: McpContext,
  ) {
    const actor = await this.actor(ctx, "POST", "history/restore");
    const result: any = await this.admin.restoreHistory(body, actor);
    return {
      restored: true,
      isDeleted: Boolean(result.isDeleted),
      item: result.item ? publicItem(result.item) : null,
    };
  }

  @Tool({
    name: "admin-get-versioning",
    title: "Read any user's branches and commits",
    description: `Read an application user's branches, the 50 most recent commits of one branch and that branch's commit timeline. Pass the nextBefore of a result as before to get older commits. ${ADMIN}`,
    inputSchema: z.object({
      userId: z.string().min(1).max(500).describe("The application's user ID, such as user_42."),
      before: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe("The nextBefore of the previous page."),
      ...scope,
    }),
    annotations: read,
  })
  async getVersioning(
    {
      before,
      ...where
    }: { userId: string; before?: string; projectId?: string; tenantId?: string; branch?: string },
    ctx: McpContext,
  ) {
    const actor = await this.actor(ctx, "GET", "versioning");
    const user = await this.admin.versionUser(sent(where), actor);
    const [branches, commits, timeline] = await Promise.all([
      this.versions.branches(user),
      this.versions.commits(user, before),
      this.versions.timeline(user),
    ]);
    return json({
      branches: branches.map((row: any) => ({ name: row.name, head: row.head ?? null })),
      commits,
      nextBefore: commits.length === 50 ? commits[commits.length - 1].id : null,
      timeline,
    });
  }

  @Tool({
    name: "admin-versioning-action",
    title: "Commit, branch or restore any user's data",
    description: `Run one versioning action on an application user's data and record it in the audit log. commit: snapshot the branch (needs message, expectedHead). fork: create a branch from a commit (needs name, commitId). restore: replace EVERY key of the branch with a commit's contents, deleting keys that are not in it (needs commitId, message, expectedHead); ask the user to confirm before a restore. ${ADMIN}`,
    inputSchema: z.object({
      action: z.enum(["commit", "fork", "restore"]),
      userId: z.string().min(1).max(500).describe("The application's user ID, such as user_42."),
      ...scope,
      message: z
        .string()
        .min(1)
        .max(500)
        .optional()
        .describe("commit, restore: why, in 1–500 characters."),
      expectedHead: z
        .string()
        .min(1)
        .nullable()
        .optional()
        .describe(
          "commit, restore: the branch's current head commit ID from admin-get-versioning; null when the branch has no commit yet.",
        ),
      commitId: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe("fork, restore: the source commit's ID."),
      name: z
        .string()
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,79}$/)
        .optional()
        .describe("fork: the new branch's name, such as drafts. Not main."),
      requestId: z
        .string()
        .regex(/^[A-Za-z0-9._:-]{1,128}$/)
        .optional()
        .describe("commit, restore: a new unique ID; send it again only to retry the same action."),
    }),
    annotations: destroy,
  })
  async versioningAction(
    {
      action,
      ...body
    }: {
      action: "commit" | "fork" | "restore";
      userId: string;
      projectId?: string;
      tenantId?: string;
      branch?: string;
      message?: string;
      expectedHead?: string | null;
      commitId?: string;
      name?: string;
      requestId?: string;
    },
    ctx: McpContext,
  ) {
    if (action !== "fork" && body.expectedHead === undefined)
      throw new BadRequestException(
        "expectedHead is required: the branch's head commit ID, or null without commits",
      );
    if (action !== "commit" && !body.commitId)
      throw new BadRequestException("commitId is required for " + action);
    const actor = await this.actor(ctx, "POST", "versioning/" + action);
    const user = await this.admin.versionUser(sent(body), actor);
    const result =
      action === "fork"
        ? await this.versions.fork(user, body)
        : action === "commit"
          ? await this.versions.checkpoint(user, body, body.requestId)
          : await this.versions.restore(user, body.commitId!, body, body.requestId);
    await this.admin.audit(actor, "admin.versioning." + action, user);
    return json({ action, result });
  }

  @Tool({
    name: "admin-disconnect-session",
    title: "Disconnect a live connection",
    description: `Close one live Socket.IO connection, on whichever API replica holds it. The client may reconnect at once unless its API key is also disabled. ${ADMIN}`,
    inputSchema: z.object({
      sessionId: z
        .string()
        .min(1)
        .max(500)
        .describe("The session's _id, from admin-list-records with resource=sessions."),
    }),
    annotations: destroy,
  })
  async disconnectSession({ sessionId }: { sessionId: string }, ctx: McpContext) {
    const actor = await this.actor(
      ctx,
      "POST",
      `sessions/${encodeURIComponent(sessionId)}/disconnect`,
    );
    return { sessionId, ...(await this.admin.disconnect(sessionId, actor)) };
  }

  @Tool({
    name: "admin-resolve-conflict",
    title: "Record a resolution for any user's conflict",
    description: `Compute the value a strategy produces for a recorded conflict and save it on the conflict record. This does NOT change the stored item: to apply resolvedValue, write it with admin-write-item. ${ADMIN}`,
    inputSchema: z.object({
      conflictId: z
        .string()
        .min(1)
        .max(500)
        .describe("The conflict's _id, from admin-list-records with resource=conflicts."),
      strategy: z
        .enum(["last_write_wins", "first_write_wins", "merge"])
        .describe(
          "last_write_wins keeps the newer value. first_write_wins keeps the original value. merge deep-merges objects and joins arrays without duplicates.",
        ),
    }),
    annotations: change,
  })
  async resolveConflict(
    { conflictId, strategy }: { conflictId: string; strategy: string },
    ctx: McpContext,
  ) {
    const actor = await this.actor(
      ctx,
      "POST",
      `conflicts/${encodeURIComponent(conflictId)}/resolve`,
    );
    const result = await this.admin.resolve(conflictId, { strategy }, actor);
    return json({
      conflictId,
      appliedToStoredItem: false,
      strategy: result.strategy,
      confidence: result.confidence ?? null,
      reason: result.reason ?? null,
      requiresReview: Boolean(result.needsManualResolution),
      resolvedValue: result.value,
    });
  }

  @Tool({
    name: "admin-update-quota",
    title: "Change a user's stored quota settings",
    description: `Change the stored limits of an existing per-user quota record. Only the fields you send change. These are stored settings: not every limit is enforced by the server yet, so do not promise the user that a limit takes effect. ${ADMIN}`,
    inputSchema: z.object({
      quotaId: z
        .string()
        .min(1)
        .max(500)
        .describe("The quota record's _id, from admin-list-records with resource=quotas."),
      maxItems: z.number().int().min(0).max(2147483647).optional(),
      maxStorageBytes: z
        .string()
        .regex(/^\d{1,18}$/)
        .optional()
        .describe('Bytes as a string of digits, such as "10485760" for 10 MiB.'),
      requestsPerMinute: z.number().int().min(0).max(2147483647).optional(),
      requestsPerHour: z.number().int().min(0).max(2147483647).optional(),
      requestsPerDay: z.number().int().min(0).max(2147483647).optional(),
      maxInstancesPerUser: z.number().int().min(0).max(2147483647).optional(),
      maxConflictsPerHour: z.number().int().min(0).max(2147483647).optional(),
      maxAuditRetentionDays: z.number().int().min(0).max(2147483647).optional(),
    }),
    annotations: change,
  })
  async updateQuota(
    { quotaId, ...settings }: { quotaId: string } & Record<string, unknown>,
    ctx: McpContext,
  ) {
    if (Object.keys(sent(settings)).length === 0)
      throw new BadRequestException("Send at least one setting to change");
    const actor = await this.actor(ctx, "PATCH", "quotas/" + encodeURIComponent(quotaId));
    return { quotaId, ...(await this.admin.quota(quotaId, sent(settings), actor)) };
  }
}
