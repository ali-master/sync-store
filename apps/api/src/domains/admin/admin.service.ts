import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import { Database, InjectDatabase } from "../../modules/db";
import { apiKeyData } from "../../modules/db/api-key-data";
import { SyncStorageService } from "../sync-storage/services/sync-storage.service";
import { SyncStorageGateway } from "../sync-storage/gateways/sync-storage.gateway";
import {
  ConflictResolutionService,
  ConflictResolutionStrategy,
} from "../sync-storage/services/conflict-resolution.service";
import { inMutation, mutationSession } from "../sync-storage/repositories/mutation-context";
import { BOOTSTRAP_KEY_ID } from "./bootstrap-key";
import { identifier, keySettings } from "./admin.validation";
import { tenantFilter, requireTenantUser, type AdminTenant } from "./tenant-scope";
import { accessPolicy, storageTenant, projectUser } from "../sync-storage/services/access-policy";
import { SyncStorageRepository } from "../sync-storage/repositories/sync-storage.repository";

export const resources = {
  tenants: "tenants",
  projects: "projects",
  history: "storage_history",
  keys: "api_keys",
  storage: "sync_storage_items",
  sessions: "sync_sessions",
  conflicts: "sync_conflicts",
  audits: "sync_audits",
  quotas: "sync_quotas",
  analytics: "sync_analytics",
  archives: "sync_archives",
} as const;

/** Convert BSON dates and 64-bit counters into lossless JSON for the inspector. */
export function publicDocument(value: any): any {
  if (value == null) return value;
  if (typeof value === "bigint" || value?._bsontype === "Long") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(publicDocument);
  if (typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, publicDocument(v)]));
  return value;
}

@Injectable()
export class AdminService {
  constructor(
    @InjectDatabase() private readonly db: Database,
    private readonly storage: SyncStorageService,
    private readonly gateway: SyncStorageGateway,
    private readonly conflicts: ConflictResolutionService,
    private readonly repository: SyncStorageRepository,
  ) {}

  /** Resolve administrative scope from the stored credential, never from submitted filters. */
  async tenant(actor: string): Promise<AdminTenant> {
    const record = await this.db.orm.api_keys.where({ id: actor }).first();
    if (!record) throw new ForbiddenException("Administrator credential unavailable");
    return record.tenantId ?? null;
  }

  private adminUser(value: unknown, tenant: AdminTenant) {
    const user = identifier(value, "user ID");
    if (!tenant) return user;
    if (user.startsWith("tenant:")) {
      requireTenantUser(user, tenant);
      return user;
    }
    return `tenant:${tenant}:` + user;
  }

  async createTenant(body: any, actor: string) {
    if (await this.tenant(actor)) throw new ForbiddenException("Platform administrator required");
    const name = identifier(body?.name, "tenant name").trim();
    if (name.length > 100) throw new BadRequestException("Tenant name is too long");
    const id = randomUUID();
    const key = "ss_admin_" + randomBytes(32).toString("hex");
    const tenant = { _id: id, name, isActive: true, createdAt: new Date() };
    const { id: keyId, ...data } = apiKeyData(name + " administrator", key);
    // Prisma cannot attach these two writes to the same ClientSession yet.
    await inMutation(this.db, async () => {
      const session = mutationSession.getStore();
      await this.db.native
        .collection<{ _id: string; [key: string]: any }>("tenants")
        .insertOne(tenant, { session });
      await this.db.native.collection<{ _id: string; [key: string]: any }>("api_keys").insertOne(
        {
          _id: keyId,
          ...data,
          tenantId: id,
          scopes: '["admin"]',
          canWrite: true,
          allowedMethods: '["GET","POST","PUT","PATCH","DELETE"]',
        },
        { session },
      );
    });
    await this.audit(actor, "admin.tenant.create", id);
    return { ...tenant, key };
  }

  /** Suspend or resume every credential owned by a tenant without changing its data. */
  async updateTenant(id: string, body: any, actor: string) {
    if (await this.tenant(actor)) throw new ForbiddenException("Platform administrator required");
    if (typeof body?.isActive !== "boolean")
      throw new BadRequestException("isActive must be boolean");
    const result = await this.db.orm.tenants.where({ id }).update({ isActive: body.isActive });
    if (!result) throw new NotFoundException("Tenant not found");
    await this.audit(actor, "admin.tenant.update", id);
    return result;
  }

  /** Dashboard ownership is resolved from the credential, never trusted from form fields. */
  async versionUser(body: any, actor: string) {
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new BadRequestException("Version scope is required");
    const tenant = await this.tenant(actor);
    if (tenant && body.tenantId && body.tenantId !== tenant)
      throw new ForbiddenException("Tenant mismatch");
    const selected = tenant ?? (body.tenantId ? identifier(body.tenantId, "tenant ID") : "default");
    if (selected !== "default" && !(await this.db.orm.tenants.where({ id: selected }).first()))
      throw new NotFoundException("Tenant not found");
    const project = identifier(body.projectId || "default", "project ID");
    await this.requireProject(project, selected === "default" ? null : selected);
    return projectUser(
      project,
      identifier(body.userId, "user ID"),
      selected,
      body.branch || "main",
    );
  }

  /** Preview history through the same tenant-scoped lookup used by application clients. */
  async previewHistory(body: any, actor: string) {
    const tenant = await this.tenant(actor);
    return this.repository.preview(
      this.adminUser(body?.userId, tenant),
      identifier(body?.key, "key"),
      identifier(body?.revision, "revision"),
    );
  }

  /** A dashboard restore is a new synchronized mutation and leaves an administrator audit entry. */
  async restoreHistory(body: any, actor: string) {
    const userId = this.adminUser(body?.userId, await this.tenant(actor)),
      key = identifier(body?.key, "key");
    const result = await this.repository.restore(
      userId,
      "dashboard",
      key,
      identifier(body?.revision, "revision"),
      body?.expected,
      identifier(body?.requestId, "request ID"),
    );
    await this.audit(actor, "admin.history.restore", userId + "/" + key);
    return result;
  }

  /** Report measured database state, not fabricated traffic or uptime history. */
  async overview(actor: string) {
    const tenant = await this.tenant(actor);
    const start = performance.now();
    await this.db.native.command({ ping: 1 });
    const databaseLatencyMs = Math.round(performance.now() - start);
    const counts = Object.fromEntries(
      await Promise.all(
        Object.entries(resources)
          .filter(([key]) => !tenant || key !== "tenants")
          .map(async ([key, collection]) => [
            key,
            (
              await this.db.aggregate(collection, [
                { $match: tenantFilter(key, tenant) },
                { $count: "total" },
              ])
            )[0]?.total ?? 0,
          ]),
      ),
    );
    const [users, sizes, keyCalls] = await Promise.all([
      this.db.aggregate("sync_storage_items", [
        { $match: tenantFilter("storage", tenant) },
        { $group: { _id: "$userId" } },
        { $count: "total" },
      ]),
      this.db.aggregate("sync_storage_items", [
        { $match: tenantFilter("storage", tenant) },
        { $group: { _id: null, bytes: { $sum: "$size" } } },
      ]),
      this.db.aggregate("api_keys", [
        { $match: tenantFilter("keys", tenant) },
        { $group: { _id: null, total: { $sum: "$totalCalls" } } },
      ]),
    ]);
    counts.sessions = (await this.gateway.getSessions()).filter(
      (row) => !tenant || storageTenant(row.userId) === tenant,
    ).length;
    return {
      tenantId: tenant,
      counts,
      users: users[0]?.total ?? 0,
      activeSessions: counts.sessions,
      storageBytes: sizes[0]?.bytes ?? 0,
      totalCalls: keyCalls[0]?.total ?? 0,
      databaseLatencyMs,
      uptimeSeconds: Math.floor(process.uptime()),
      database: this.db.native.databaseName,
      runtime: "Bun",
      timestamp: new Date().toISOString(),
    };
  }

  /** Paginate only known collections and literal searches; secrets never appear in list results. */
  async list(resource: string, query: Record<string, string>, actor: string) {
    const tenant = await this.tenant(actor);
    const collection = resources[resource as keyof typeof resources];
    if (!Object.hasOwn(resources, resource)) throw new NotFoundException("Unknown resource");
    const page = Number(query.page || 1);
    if (!Number.isInteger(page) || page < 1 || page > 10000)
      throw new BadRequestException("Invalid page");
    if (resource === "sessions") {
      const q = query.q ? identifier(query.q, "search").toLowerCase() : "";
      const rows = (await this.gateway.getSessions())
        .filter(
          (session) =>
            (!tenant || storageTenant(session.userId) === tenant) &&
            (!query.userId || session.userId === query.userId) &&
            [session.userId, session.instanceId, session.socketId].some((value) =>
              value.toLowerCase().includes(q),
            ),
        )
        .sort(
          (a, b) => b.connectedAt.getTime() - a.connectedAt.getTime() || a._id.localeCompare(b._id),
        );
      return {
        items: publicDocument(rows.slice((page - 1) * 25, page * 25)),
        total: rows.length,
        page,
        pageSize: 25,
      };
    }
    const filter: Record<string, any> = tenantFilter(resource, tenant);
    if (resource === "history") filter.expiresAt = { $gt: new Date() };
    if (query.userId) filter.userId = this.adminUser(query.userId, tenant);
    if (query.q) {
      const q = identifier(query.q, "search").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const fields =
        resource === "keys" || resource === "projects"
          ? ["name", "_id"]
          : ["userId", "key", "instanceId", "_id", "action", "status"];
      filter.$or = fields.map((field) => ({ [field]: { $regex: q, $options: "i" } }));
    }
    const [items, count] = await Promise.all([
      this.db.aggregate(collection, [
        { $match: filter },
        {
          $sort:
            resource === "history" ? { lastModified: -1, _id: -1 } : { createdAt: -1, _id: -1 },
        },
        { $skip: (page - 1) * 25 },
        { $limit: 25 },
        ...(resource === "keys" ? [{ $project: { key: 0 } }] : []),
      ]),
      this.db.aggregate(collection, [{ $match: filter }, { $count: "total" }]),
    ]);
    const total = count[0]?.total ?? 0;
    return { items: publicDocument(items), total, page, pageSize: 25 };
  }

  /** Persist an administrative action without including keys or stored payloads. */
  async audit(actor: string, action: string, target: string) {
    const tenant = await this.tenant(actor);
    await this.db.orm.sync_audits.create({
      id: randomUUID(),
      userId: (tenant ? `tenant:${tenant}:` : "") + "admin:" + actor,
      instanceId: "dashboard",
      itemId: null,
      action,
      oldValue: null,
      newValue: null,
      changeSize: 0,
      ipAddress: null,
      userAgent: null,
      country: null,
      sessionId: null,
      executionTimeMs: 0,
      memoryUsageMb: null,
      networkLatencyMs: null,
      metadata: JSON.stringify({ target }),
      tags: '["admin"]',
      createdAt: new Date(),
    });
  }

  /** Issue an application key and reveal its secret only in this response. */
  async createKey(body: unknown, actor: string) {
    const settings = keySettings(body);
    const tenant = await this.tenant(actor);
    await this.requireProject(accessPolicy(settings).projectId, tenant);
    if (!settings.name) throw new BadRequestException("Name is required");
    const key = "ss_" + randomBytes(32).toString("hex");
    const row = await this.db.orm.api_keys.create({
      ...apiKeyData(settings.name, key),
      scopes: "[]",
      allowedMethods: '["GET","POST","PUT","PATCH","DELETE"]',
      ...settings,
      tenantId: tenant,
    });
    await this.audit(actor, "admin.key.create", row.id);
    return { id: row.id, key };
  }

  /** Edit application policy while keeping the installation administrator recoverable. */
  async updateKey(id: string, body: unknown, actor: string) {
    if (id === BOOTSTRAP_KEY_ID)
      throw new ConflictException(
        "The installation administrator cannot be disabled or restricted here",
      );
    const tenant = await this.tenant(actor);
    const previous = await this.db.orm.api_keys
      .where({ id, ...(tenant ? { tenantId: tenant } : {}) })
      .first();
    if (!previous) throw new NotFoundException("Key not found");
    const settings = keySettings(body);
    if (settings.metadata && accessPolicy(settings).projectId !== accessPolicy(previous).projectId)
      throw new BadRequestException("Project binding is immutable; create a new API key");
    await this.db.orm.api_keys.where({ id }).update({ ...settings, updatedAt: new Date() });
    await this.audit(actor, "admin.key.update", id);
    return { updated: true };
  }

  /** Create an isolated application namespace without moving existing data. */
  async createProject(body: any, actor: string) {
    const name = identifier(body?.name, "project name").trim();
    if (name.length > 100) throw new BadRequestException("Project name is too long");
    const row = await this.db.orm.projects.create({
      id: randomUUID(),
      tenantId: await this.tenant(actor),
      name,
      createdAt: new Date(),
    });
    const project = { ...row, _id: row.id };
    await this.audit(actor, "admin.project.create", project._id);
    return project;
  }

  private async requireProject(id: string, tenant: AdminTenant) {
    if (
      id !== "default" &&
      !(await this.db.orm.projects.where({ id, ...(tenant ? { tenantId: tenant } : {}) }).first())
    )
      throw new BadRequestException("Project does not exist");
  }

  /** Rotate credentials explicitly; existing clients must switch to the new secret. */
  async rotateKey(id: string, actor: string) {
    const tenant = await this.tenant(actor);
    if (
      !(await this.db.orm.api_keys.where({ id, ...(tenant ? { tenantId: tenant } : {}) }).first())
    )
      throw new NotFoundException("Key not found");
    const key = (id === BOOTSTRAP_KEY_ID ? "ss_admin_" : "ss_") + randomBytes(32).toString("hex");
    await this.db.orm.api_keys.where({ id }).update({ key, updatedAt: new Date() });
    await this.audit(actor, "admin.key.rotate", id);
    return { key };
  }

  /** Use normal storage commands so dashboard mutations publish synchronization events. */
  async write(body: any, actor: string) {
    if (!body || !Object.hasOwn(body, "value"))
      throw new BadRequestException("JSON value is required");
    const userId = this.adminUser(body.userId, await this.tenant(actor)),
      key = identifier(body.key, "storage key");
    const result = await this.storage.setItem(userId, "dashboard", key, body.value);
    await this.audit(actor, "admin.storage.write", userId + "/" + key);
    return result;
  }

  /** Delete only the selected user's key, through the broadcast-aware storage service. */
  async remove(body: any, actor: string) {
    const userId = this.adminUser(body?.userId, await this.tenant(actor)),
      key = identifier(body?.key, "storage key");
    await this.storage.removeItem(userId, "dashboard", key);
    await this.audit(actor, "admin.storage.delete", userId + "/" + key);
    return { deleted: true };
  }

  /** Close the live socket on its owning replica, rather than editing a stored session record. */
  async disconnect(id: string, actor: string) {
    const session = (await this.gateway.getSessions()).find((entry) => entry._id === id);
    if (!session) throw new NotFoundException("Session not found");
    requireTenantUser(session.userId, await this.tenant(actor));
    if (!session.socketId || session.disconnectedAt)
      throw new ConflictException("Session is already disconnected or is not a socket");
    if (!(await this.gateway.disconnectSession(session.socketId))) {
      throw new ConflictException("Session is no longer connected to this server");
    }
    await this.audit(actor, "admin.session.disconnect", id);
    return { disconnected: true };
  }

  /** Record a resolution proposal using supported deterministic strategies; never silently apply it. */
  async resolve(id: string, body: any, actor: string) {
    if (!["last_write_wins", "first_write_wins", "merge"].includes(body?.strategy))
      throw new BadRequestException("Unsupported resolution strategy");
    const conflict = await this.db.orm.sync_conflicts.where({ id }).first();
    if (!conflict) throw new NotFoundException("Conflict not found");
    requireTenantUser(conflict.userId, await this.tenant(actor));
    const result = await this.conflicts.resolveConflictById(
      id,
      conflict.userId,
      body.strategy as ConflictResolutionStrategy,
      { userReview: true },
    );
    await this.audit(actor, "admin.conflict.resolve", id);
    return result;
  }

  /** Configure stored per-user limits; only enforced fields are exposed as effective controls in docs. */
  async quota(id: string, body: any, actor: string) {
    const allowed = [
      "maxItems",
      "requestsPerMinute",
      "requestsPerHour",
      "requestsPerDay",
      "maxInstancesPerUser",
      "maxConflictsPerHour",
      "maxAuditRetentionDays",
    ];
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new BadRequestException("Expected settings object");
    const data: Record<string, any> = {};
    for (const [field, value] of Object.entries(body)) {
      if (field === "maxStorageBytes") {
        if (typeof value !== "string" || !/^\d{1,18}$/.test(value))
          throw new BadRequestException("Storage bytes must be a nonnegative integer string");
        data[field] = BigInt(value);
      } else {
        if (
          !allowed.includes(field) ||
          !Number.isInteger(value) ||
          Number(value) < 0 ||
          Number(value) > 2147483647
        )
          throw new BadRequestException("Invalid quota setting: " + field);
        data[field] = value;
      }
    }
    const quota = await this.db.orm.sync_quotas.where({ id }).first();
    if (!quota) throw new NotFoundException("Quota not found");
    requireTenantUser(quota.userId, await this.tenant(actor));
    await this.db.orm.sync_quotas.where({ id }).update({ ...data, updatedAt: new Date() });
    await this.audit(actor, "admin.quota.update", id);
    return { updated: true };
  }
}
