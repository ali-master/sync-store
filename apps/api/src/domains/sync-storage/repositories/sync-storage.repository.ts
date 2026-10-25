import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { MongoFieldFilter } from "@prisma/orm-mongo/query-ast/execution";
import type { Filter } from "mongodb";
import { StorageItem } from "../entities/storage-item.entity";
import { InjectDatabase, Database } from "@root/modules/db";
import type { Models } from "@root/modules/db/contract.d";
import { mutationSession, runMutation, inMutation } from "./mutation-context";

interface StorageData {
  userId: string;
  instanceId: string;
  key: string;
  value: unknown;
  metadata?: Record<string, any>;
  version: number;
  timestamp: number;
  lastModified: Date;
  isDeleted?: boolean;
}
type Item = Omit<Models.unbound_SyncStorageItem, "conflicts" | "audits">;
type ItemDocument = Omit<Item, "id" | "conflicts" | "audits"> & { _id: string; outbox?: unknown[] };

/** Append an immutable event in the same atomic update as its storage mutation. */
function appendEvent(type: "sync" | "remove") {
  return {
    $set: {
      outbox: {
        $concatArrays: [
          { $ifNull: ["$outbox", []] },
          [
            {
              eventId: { $concat: ["$_id", ":", { $toString: "$version" }] },
              recordId: "$_id",
              userId: "$userId",
              key: "$key",
              instanceId: "$instanceId",
              type,
              value: "$value",
              metadata: "$metadata",
              version: "$version",
              timestamp: { $toDouble: "$lastModified" },
            },
          ],
        ],
      },
    },
  };
}

/** Persists tenant-scoped items; MongoDB assigns each write its version atomically. */
@Injectable()
export class SyncStorageRepository {
  constructor(@InjectDatabase() private readonly database: Database) {}

  /** Share a durable result for retries of the same authenticated operation. */
  mutate<T>(
    userId: string,
    requestId: string | undefined,
    payload: unknown,
    work: () => Promise<T>,
  ) {
    return runMutation(this.database, userId, requestId, payload, work);
  }

  private writeOptions() {
    const session = mutationSession.getStore();
    return session ? { session } : { writeConcern: { w: "majority" as const, j: true } };
  }

  private get collection() {
    return this.database.native.collection<ItemDocument>("sync_storage_items");
  }

  private toEntity(item: Item): StorageItem {
    return new StorageItem({
      id: item.id,
      userId: item.userId,
      instanceId: item.instanceId,
      key: item.key,
      value: JSON.parse(item.value),
      metadata: item.metadata ? JSON.parse(item.metadata) : undefined,
      version: item.version,
      timestamp: Number(item.timestamp),
      lastModified: item.lastModified,
      isDeleted: item.isDeleted,
    });
  }

  private query(userId: string, prefix?: string) {
    let query = this.database.orm.sync_storage_items.where({ userId, isDeleted: false });
    if (prefix)
      query = query.where(
        MongoFieldFilter.of("key", "$regex", "^" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    return query;
  }

  async findByKey(userId: string, key: string): Promise<StorageItem | null> {
    const session = mutationSession.getStore();
    if (session) {
      const item = await this.collection.findOne(
        { userId, key, isDeleted: false },
        { session, useBigInt64: true },
      );
      return item ? this.toEntity({ ...item, id: item._id } as Item) : null;
    }
    const item = await this.database.orm.sync_storage_items
      .where({ userId, key, isDeleted: false })
      .first();
    return item ? this.toEntity(item) : null;
  }

  async findAll(userId: string, prefix?: string): Promise<StorageItem[]> {
    return (await this.query(userId, prefix).orderBy({ timestamp: -1 }).all()).map((item) =>
      this.toEntity(item),
    );
  }

  async findKeys(userId: string, prefix?: string): Promise<string[]> {
    return (await this.query(userId, prefix).select("key").orderBy({ key: 1 }).all()).map(
      (item) => item.key,
    );
  }

  async upsert(data: StorageData): Promise<StorageItem> {
    return inMutation(this.database, () => this.save(data));
  }

  private async save(data: StorageData): Promise<StorageItem> {
    const previous = await this.collection.findOne(
      { userId: data.userId, key: data.key },
      { session: mutationSession.getStore(), useBigInt64: true },
    );
    if (previous) await this.snapshot(previous);
    const value = JSON.stringify(data.value);
    if (value === undefined) throw new TypeError("Storage values must be JSON serializable");
    const document = await this.collection.findOneAndUpdate(
      { userId: data.userId, key: data.key },
      [
        {
          $set: {
            instanceId: { $literal: data.instanceId },
            value: { $literal: value },
            metadata: { $literal: data.metadata ? JSON.stringify(data.metadata) : null },
            timestamp: { $literal: BigInt(data.timestamp) },
            lastModified: "$$NOW",
            size: Buffer.byteLength(value),
            isDeleted: false,
            version: { $add: [{ $ifNull: ["$version", 0] }, 1] },
            _id: { $ifNull: ["$_id", { $literal: randomUUID() }] },
            userId: { $literal: data.userId },
            key: { $literal: data.key },
            compressionType: { $ifNull: ["$compressionType", null] },
            encryptionType: { $ifNull: ["$encryptionType", null] },
            tags: { $ifNull: ["$tags", null] },
            ttl: { $ifNull: ["$ttl", null] },
            priority: { $ifNull: ["$priority", 0] },
          },
        },
        appendEvent("sync"),
      ],
      {
        upsert: true,
        returnDocument: "after",
        useBigInt64: true,
        ...this.writeOptions(),
      },
    );
    if (!document) throw new Error("MongoDB did not return the saved item");
    await this.snapshot(document);
    const { _id, ...fields } = document;
    return this.toEntity({ ...fields, id: _id } as Item);
  }

  async delete(userId: string, key: string, instanceId = "server"): Promise<void> {
    await inMutation(this.database, async () => {
      const previous = await this.collection.findOne(
        { userId, key, isDeleted: false },
        { session: mutationSession.getStore(), useBigInt64: true },
      );
      if (previous) await this.snapshot(previous);
      const document = await this.collection.findOneAndUpdate(
        { userId, key, isDeleted: false },
        this.deletion(instanceId),
        {
          ...this.writeOptions(),
          returnDocument: "after",
          useBigInt64: true,
        },
      );
      if (document) await this.snapshot(document);
    });
  }

  async clearAll(userId: string, instanceId = "server"): Promise<void> {
    await inMutation(this.database, async () => {
      const session = mutationSession.getStore();
      const items = await this.collection
        .find({ userId, isDeleted: false }, { session, projection: { key: 1 } })
        .toArray();
      for (const item of items) await this.delete(userId, item.key, instanceId);
    });
  }

  /** Retain immutable versions separately so item documents do not grow with history. */
  private async snapshot(document: ItemDocument) {
    const days = Number(process.env.HISTORY_RETENTION_DAYS ?? 30);
    if (!Number.isInteger(days) || days < 1 || days > 3650)
      throw new Error("HISTORY_RETENTION_DAYS must be an integer between 1 and 3650");
    const { _id, userId, key, value, metadata, version, isDeleted, lastModified, instanceId } =
      document;
    const snapshot = {
      _id: `${_id}:${version}`,
      recordId: _id,
      userId,
      key,
      value,
      metadata,
      version,
      isDeleted,
      lastModified,
      instanceId,
      expiresAt: new Date(Date.now() + days * 86400000),
    };
    await this.database.native
      .collection<{ _id: string; [key: string]: any }>("storage_history")
      .updateOne(
        { _id: snapshot._id },
        { $setOnInsert: snapshot },
        { upsert: true, session: mutationSession.getStore() },
      );
  }

  /** Page retained versions, including tombstones for deleted keys. */
  async history(userId: string, key: string, before?: string) {
    const history = this.database.native.collection<{ _id: string; [key: string]: any }>(
      "storage_history",
    );
    const cursor = before ? await history.findOne({ _id: before, userId, key }) : null;
    if (before && !cursor) throw new BadRequestException("History cursor expired; reload history");
    return history
      .find({
        userId,
        key,
        expiresAt: { $gt: new Date() },
        ...(cursor
          ? {
              $or: [
                { lastModified: { $lt: cursor.lastModified } },
                { lastModified: cursor.lastModified, version: { $lt: cursor.version } },
                {
                  lastModified: cursor.lastModified,
                  version: cursor.version,
                  _id: { $lt: cursor._id },
                },
              ],
            }
          : {}),
      })
      .sort({ lastModified: -1, version: -1, _id: -1 })
      .limit(50)
      .toArray();
  }

  /** Preview a retained version together with the exact current revision required by restore. */
  async preview(userId: string, key: string, revision: string) {
    const snapshot = await this.database.native
      .collection<{ _id: string; [key: string]: any }>("storage_history")
      .findOne(
        { _id: revision, userId, key, expiresAt: { $gt: new Date() } },
        { session: mutationSession.getStore() },
      );
    if (!snapshot) throw new NotFoundException("Retained version not found");
    const current = await this.collection.findOne(
      { userId, key },
      { session: mutationSession.getStore(), useBigInt64: true },
    );
    return {
      snapshot,
      current: current
        ? {
            id: current._id,
            version: current.version,
            value: current.value,
            metadata: current.metadata,
            isDeleted: current.isDeleted,
          }
        : null,
    };
  }

  /** Restore as a new version; reject a stale preview instead of overwriting a concurrent edit. */
  async restore(
    userId: string,
    instanceId: string,
    key: string,
    revision: string,
    expected: { id: string; version: number } | null,
    requestId?: string,
  ) {
    if (
      expected !== null &&
      (!expected || typeof expected.id !== "string" || !Number.isInteger(expected.version))
    )
      throw new BadRequestException("Expected current revision is required");
    return this.mutate(
      userId,
      requestId,
      { type: "restore", key, revision, expected },
      async () => {
        const { snapshot, current } = await this.preview(userId, key, revision);
        if (current?.id !== expected?.id || current?.version !== expected?.version)
          throw new ConflictException("Item changed since preview; preview again before restoring");
        if (snapshot.isDeleted) {
          await this.delete(userId, key, instanceId);
          return { restored: true, isDeleted: true };
        }
        const item = await this.upsert({
          userId,
          instanceId,
          key,
          value: JSON.parse(snapshot.value),
          metadata: snapshot.metadata ? JSON.parse(snapshot.metadata) : undefined,
          timestamp: Date.now(),
          lastModified: new Date(),
          version: 1,
        });
        return { restored: true, item };
      },
    );
  }

  /** Clear is atomic per item; every deleted item retains its own durable remove event. */
  private deletion(instanceId: string) {
    return [
      {
        $set: {
          isDeleted: true,
          lastModified: "$$NOW",
          instanceId: { $literal: instanceId },
          version: { $add: ["$version", 1] },
        },
      },
      appendEvent("remove"),
    ];
  }

  async exists(userId: string, key: string): Promise<boolean> {
    return (await this.findByKey(userId, key)) !== null;
  }

  async count(userId: string, prefix?: string): Promise<number> {
    return this.collection.countDocuments({
      userId,
      isDeleted: false,
      ...(prefix ? { key: { $regex: "^" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") } } : {}),
    });
  }

  async getStorageStats(userId?: string) {
    const filter = userId ? { userId } : {};
    const [totalItems, deletedItems, sizes, users] = await Promise.all([
      this.collection.countDocuments({ ...filter, isDeleted: false }),
      this.collection.countDocuments({ ...filter, isDeleted: true }),
      this.collection
        .aggregate<{ size: number }>([
          { $match: { ...filter, isDeleted: false } },
          { $group: { _id: null, size: { $sum: "$size" } } },
        ])
        .toArray(),
      this.collection.distinct("userId", { ...filter, isDeleted: false }),
    ]);
    return { totalItems, deletedItems, storageSize: sizes[0]?.size ?? 0, totalUsers: users.length };
  }

  async cleanup(maxAge?: number): Promise<number> {
    const filter: Filter<ItemDocument> = { isDeleted: true, "outbox.0": { $exists: false } };
    if (maxAge !== undefined) {
      if (!Number.isFinite(maxAge) || maxAge < 0)
        throw new RangeError("maxAge must be nonnegative");
      filter.lastModified = { $lt: new Date(Date.now() - maxAge) };
    }
    // References remain available in audit/conflict history after physical cleanup.
    return (await this.collection.deleteMany(filter)).deletedCount;
  }

  async export(userId?: string): Promise<StorageData[]> {
    let query = this.database.orm.sync_storage_items.where({ isDeleted: false });
    if (userId) query = query.where({ userId });
    return (await query.orderBy({ lastModified: -1 }).all()).map((item) => ({
      userId: item.userId,
      instanceId: item.instanceId,
      key: item.key,
      value: JSON.parse(item.value),
      metadata: item.metadata ? JSON.parse(item.metadata) : undefined,
      version: item.version,
      timestamp: Number(item.timestamp),
      lastModified: item.lastModified,
      isDeleted: item.isDeleted,
    }));
  }

  async import(items: StorageData[]): Promise<number> {
    for (const item of items) {
      if (!item.userId || !item.key || item.value === undefined)
        throw new TypeError("Invalid imported item");
      await this.upsert(item);
    }
    return items.length;
  }
}
