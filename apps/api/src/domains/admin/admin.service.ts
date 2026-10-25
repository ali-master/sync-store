import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
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
import { BOOTSTRAP_KEY_ID } from "./bootstrap-key";
import { identifier, keySettings } from "./admin.validation";

export const resources = {
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
  ) {}

  /** Report measured database state, not fabricated traffic or uptime history. */
  async overview() {
    const start = performance.now();
    await this.db.native.command({ ping: 1 });
    const databaseLatencyMs = Math.round(performance.now() - start);
    const counts = Object.fromEntries(
      await Promise.all(
        Object.entries(resources).map(async ([key, collection]) => [
          key,
          await this.db.native.collection(collection).countDocuments(),
        ]),
      ),
    );
    const [users, sizes, keyCalls] = await Promise.all([
      this.db.native
        .collection("sync_storage_items")
        .aggregate([{ $group: { _id: "$userId" } }, { $count: "total" }])
        .toArray(),
      this.db.native
        .collection("sync_storage_items")
        .aggregate([{ $group: { _id: null, bytes: { $sum: "$size" } } }])
        .toArray(),
      this.db.native
        .collection("api_keys")
        .aggregate([{ $group: { _id: null, total: { $sum: "$totalCalls" } } }])
        .toArray(),
    ]);
    counts.sessions = (await this.gateway.getSessions()).length;
    return {
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
  async list(resource: string, query: Record<string, string>) {
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
    const filter: Record<string, any> = {};
    if (query.userId) filter.userId = identifier(query.userId, "user ID");
    if (query.q) {
      const q = identifier(query.q, "search").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const fields =
        resource === "keys"
          ? ["name", "_id"]
          : ["userId", "key", "instanceId", "_id", "action", "status"];
      filter.$or = fields.map((field) => ({ [field]: { $regex: q, $options: "i" } }));
    }
    const db = this.db.native.collection(collection);
    const [items, total] = await Promise.all([
      db
        .find(filter, resource === "keys" ? { projection: { key: 0 } } : {})
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * 25)
        .limit(25)
        .toArray(),
      db.countDocuments(filter),
    ]);
    return { items: publicDocument(items), total, page, pageSize: 25 };
  }

  /** Persist an administrative action without including keys or stored payloads. */
  async audit(actor: string, action: string, target: string) {
    await this.db.orm.sync_audits.create({
      id: randomUUID(),
      userId: "admin:" + actor,
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
    if (!settings.name) throw new BadRequestException("Name is required");
    const key = "ss_" + randomBytes(32).toString("hex");
    const row = await this.db.orm.api_keys.create({
      ...apiKeyData(settings.name, key),
      scopes: "[]",
      allowedMethods: '["GET","POST","PUT","PATCH","DELETE"]',
      ...settings,
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
    if (!(await this.db.orm.api_keys.where({ id }).first()))
      throw new NotFoundException("Key not found");
    await this.db.orm.api_keys
      .where({ id })
      .update({ ...keySettings(body), updatedAt: new Date() });
    await this.audit(actor, "admin.key.update", id);
    return { updated: true };
  }

  /** Rotate credentials explicitly; existing clients must switch to the new secret. */
  async rotateKey(id: string, actor: string) {
    if (!(await this.db.orm.api_keys.where({ id }).first()))
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
    const userId = identifier(body.userId, "user ID"),
      key = identifier(body.key, "storage key");
    const result = await this.storage.setItem(userId, "dashboard", key, body.value);
    await this.audit(actor, "admin.storage.write", userId + "/" + key);
    return result;
  }

  /** Delete only the selected user's key, through the broadcast-aware storage service. */
  async remove(body: any, actor: string) {
    const userId = identifier(body?.userId, "user ID"),
      key = identifier(body?.key, "storage key");
    await this.storage.removeItem(userId, "dashboard", key);
    await this.audit(actor, "admin.storage.delete", userId + "/" + key);
    return { deleted: true };
  }

  /** Close the live socket on its owning replica, rather than editing a stored session record. */
  async disconnect(id: string, actor: string) {
    const session = (await this.gateway.getSessions()).find((entry) => entry._id === id);
    if (!session) throw new NotFoundException("Session not found");
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
    if (!(await this.db.orm.sync_quotas.where({ id }).first()))
      throw new NotFoundException("Quota not found");
    await this.db.orm.sync_quotas.where({ id }).update({ ...data, updatedAt: new Date() });
    await this.audit(actor, "admin.quota.update", id);
    return { updated: true };
  }
}
