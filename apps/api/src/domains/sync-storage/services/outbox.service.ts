import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { InjectDatabase, Database } from "@root/modules/db";
import { SyncStorageGateway } from "../gateways/sync-storage.gateway";

/** A stored event survives process death together with the item mutation that produced it. */
export interface OutboxEvent {
  eventId: string;
  recordId: string;
  userId: string;
  key: string;
  instanceId: string;
  type: "sync" | "remove";
  value: string;
  metadata: string | null;
  version: number;
  timestamp: number;
}

/** Drain per-item ordered queues with recoverable leases shared by all API replicas. */
@Injectable()
export class OutboxService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxService.name);
  private redis?: ReturnType<typeof createClient>;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private get collection() {
    return this.database.native.collection<{
      _id: string;
      outbox: OutboxEvent[];
      leaseToken?: string;
      leaseUntil?: Date;
    }>("sync_storage_items");
  }

  constructor(
    @InjectDatabase() private readonly database: Database,
    private readonly gateway: SyncStorageGateway,
  ) {}

  /** Index only pending work; never scan the full storage collection on each poll. */
  async onApplicationBootstrap() {
    await this.collection.createIndex(
      { leaseUntil: 1 },
      { name: "outbox_pending", partialFilterExpression: { "outbox.0": { $exists: true } } },
    );
    if (process.env.REDIS_URL) {
      this.redis = createClient({
        url: process.env.REDIS_URL,
        disableOfflineQueue: true,
        socket: { connectTimeout: 5000 },
      });
      this.redis.on("error", () =>
        this.logger.warn("Outbox Redis unavailable; pending events retained"),
      );
      await this.redis.connect();
    }
    this.schedule();
  }

  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.drain().finally(() => this.schedule());
    }, 100);
  }

  /** Delete only the acknowledged head and only while still owning its lease. */
  async drain() {
    try {
      for (let i = 0; i < 100 && !this.stopped; i++) {
        const token = randomUUID();
        const document = await this.collection.findOneAndUpdate(
          {
            "outbox.0": { $exists: true },
            $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: new Date() } }],
          },
          { $set: { leaseToken: token, leaseUntil: new Date(Date.now() + 15000) } },
          { returnDocument: "after" },
        );
        if (!document) return;
        const event = document.outbox[0];
        await this.publish(event);
        await this.collection.updateOne(
          { _id: document._id, leaseToken: token, "outbox.0.eventId": event.eventId },
          {
            $pop: { outbox: -1 },
            $unset: { leaseToken: "", leaseUntil: "" },
          },
          { writeConcern: { w: "majority", j: true } },
        );
      }
    } catch {
      this.logger.warn("Outbox delivery failed; lease expiry will retry the pending event");
    }
  }

  /** Wait for Redis persistence, not Socket.IO's fire-and-forget emit return value. */
  private async publish(event: OutboxEvent) {
    const name = event.type === "sync" ? "sync:update" : "sync:remove";
    const data = {
      ...event,
      timestamp: Number(event.timestamp),
      value: event.type === "sync" ? JSON.parse(event.value) : undefined,
      metadata: event.metadata ? JSON.parse(event.metadata) : undefined,
    };
    const rooms = await this.gateway.recipientRooms(event.userId, event.key);
    if (!rooms.length) return;
    if (!this.redis) {
      this.gateway.broadcastToRooms(rooms, name, data);
      return;
    }
    if (!this.redis.isReady) throw new Error("Redis unavailable");
    // Socket.IO Redis Streams 0.3.x wire format; emitter UID includes the publishing node.
    await this.redis.xAdd(
      `${process.env.SOCKET_IO_PREFIX || "sync-store"}:events`,
      "*",
      {
        uid: "emitter",
        nsp: "/sync",
        type: "3",
        data: JSON.stringify({
          packet: { type: 2, nsp: "/sync", data: [name, data] },
          opts: { rooms, except: [], flags: {} },
        }),
      },
      { TRIM: { strategy: "MAXLEN", strategyModifier: "~", threshold: 100000 } },
    );
    const persisted = (await this.redis.sendCommand(["WAITAOF", "1", "0", "5000"])) as number[];
    if (persisted[0] !== 1) throw new Error("Redis AOF persistence not confirmed");
  }

  /** Pending work stays in MongoDB when a process shuts down or is killed. */
  onApplicationShutdown() {
    this.stopped = true;
    clearTimeout(this.timer);
    if (this.redis?.isOpen) this.redis.destroy();
  }
}
