import { Injectable, Logger } from "@nestjs/common";
import { ItemSyncedEvent } from "../events/impl/item-synced.event";
import { ItemRemovedEvent } from "../events/impl/item-removed.event";

export interface QueuedUpdate {
  type: "set" | "remove";
  userId: string;
  instanceId: string;
  key: string;
  value?: any;
  metadata?: Record<string, any>;
  timestamp: number;
  version?: number;
}

@Injectable()
export class SyncQueueService {
  private readonly logger = new Logger(SyncQueueService.name);
  private readonly queues = new Map<string, QueuedUpdate[]>();
  private readonly maxQueueSize = 100;
  private readonly maxAge = 60 * 60 * 1000; // 1 hour

  async queueUpdate(event: ItemSyncedEvent): Promise<void> {
    const queueKey = this.getQueueKey(event.userId, event.instanceId);

    if (!this.queues.has(queueKey)) {
      this.queues.set(queueKey, []);
    }

    const queue = this.queues.get(queueKey)!;
    const update: QueuedUpdate = {
      type: "set",
      userId: event.userId,
      instanceId: event.instanceId,
      key: event.key,
      value: event.value,
      metadata: event.metadata,
      timestamp: event.timestamp,
    };

    queue.unshift(update);

    if (queue.length > this.maxQueueSize) {
      queue.splice(this.maxQueueSize);
    }

    this.logger.debug(`Queued update for ${queueKey}: ${event.key}`);
  }

  async queueRemoval(event: ItemRemovedEvent): Promise<void> {
    const queueKey = this.getQueueKey(event.userId, event.instanceId);

    if (!this.queues.has(queueKey)) {
      this.queues.set(queueKey, []);
    }

    const queue = this.queues.get(queueKey)!;
    const update: QueuedUpdate = {
      type: "remove",
      userId: event.userId,
      instanceId: event.instanceId,
      key: event.key,
      timestamp: event.timestamp,
    };

    queue.unshift(update);

    if (queue.length > this.maxQueueSize) {
      queue.splice(this.maxQueueSize);
    }

    this.logger.debug(`Queued removal for ${queueKey}: ${event.key}`);
  }

  async getPendingUpdates(
    userId: string,
    instanceId: string,
    since?: number,
  ): Promise<QueuedUpdate[]> {
    const queueKey = this.getQueueKey(userId, instanceId);
    const queue = this.queues.get(queueKey) || [];

    let updates = queue;

    if (since) {
      updates = queue.filter((update) => update.timestamp > since);
    }

    this.cleanupOldUpdates(queueKey);

    this.logger.debug(`Retrieved ${updates.length} pending updates for ${queueKey}`);
    return updates.slice();
  }

  async clearQueue(userId: string, instanceId?: string): Promise<void> {
    if (instanceId) {
      const queueKey = this.getQueueKey(userId, instanceId);
      this.queues.delete(queueKey);
      this.logger.debug(`Cleared queue for ${queueKey}`);
    } else {
      const keysToDelete = Array.from(this.queues.keys()).filter((key) =>
        key.startsWith(`${userId}:`),
      );

      keysToDelete.forEach((key) => this.queues.delete(key));
      this.logger.debug(`Cleared all queues for user ${userId}`);
    }
  }

  async getQueueSize(userId: string, instanceId: string): Promise<number> {
    const queueKey = this.getQueueKey(userId, instanceId);
    const queue = this.queues.get(queueKey) || [];
    return queue.length;
  }

  async getAllQueueSizes(): Promise<Record<string, number>> {
    const sizes: Record<string, number> = {};

    for (const [key, queue] of this.queues.entries()) {
      sizes[key] = queue.length;
    }

    return sizes;
  }

  private getQueueKey(userId: string, instanceId: string): string {
    return `${userId}:${instanceId}`;
  }

  private cleanupOldUpdates(queueKey: string): void {
    const queue = this.queues.get(queueKey);
    if (!queue) return;

    const cutoff = Date.now() - this.maxAge;
    const filteredQueue = queue.filter((update) => update.timestamp >= cutoff);

    if (filteredQueue.length !== queue.length) {
      this.queues.set(queueKey, filteredQueue);
      this.logger.debug(
        `Cleaned up ${queue.length - filteredQueue.length} old updates for ${queueKey}`,
      );
    }
  }

  async performMaintenance(): Promise<{
    queuesProcessed: number;
    updatesRemoved: number;
    emptyQueuesRemoved: number;
  }> {
    let queuesProcessed = 0;
    let updatesRemoved = 0;
    let emptyQueuesRemoved = 0;

    const cutoff = Date.now() - this.maxAge;

    for (const [queueKey, queue] of this.queues.entries()) {
      queuesProcessed++;
      const originalLength = queue.length;

      const filteredQueue = queue.filter((update) => update.timestamp >= cutoff);
      updatesRemoved += originalLength - filteredQueue.length;

      if (filteredQueue.length === 0) {
        this.queues.delete(queueKey);
        emptyQueuesRemoved++;
      } else if (filteredQueue.length !== originalLength) {
        this.queues.set(queueKey, filteredQueue);
      }
    }

    this.logger.log(
      `Maintenance completed: ${queuesProcessed} queues processed, ` +
        `${updatesRemoved} updates removed, ${emptyQueuesRemoved} empty queues removed`,
    );

    return { queuesProcessed, updatesRemoved, emptyQueuesRemoved };
  }
}
