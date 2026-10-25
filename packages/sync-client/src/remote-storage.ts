import {
  createTransport,
  TransportMode,
  HttpTransport,
  type ITransport,
  type TransportResponse,
} from "./transport";
import type {
  RemoteStorageConfig,
  StorageItem,
  SyncEvent,
  ConflictData,
  BatchOperation,
  BatchResult,
  SyncFilter,
  ConnectionInfo,
  ChangeEvent,
  NetworkChangeEvent,
  RetryConfig,
} from "./types";
import { ConnectionState, ConflictStrategy, MergeStrategy } from "./types";
import { EventEmitter } from "./core/event-emitter";
import { ConflictResolver } from "./core/conflict-resolver";
import { NetworkManager } from "./core/network-manager";
import { Analytics } from "./core/analytics";
import { DataStorage } from "./utils/storage";
import { Logger } from "./utils/logger";
import { retryConfigs } from "./utils/retry";
import { generateInstanceId } from "./utils/base";

interface RemoteStorageEvents {
  change: ChangeEvent;
  sync: SyncEvent;
  connect: Record<string, never>;
  disconnect: Record<string, never>;
  reconnect: Record<string, never>;
  error: { type: string; message: string; error: any };
  conflict: ConflictData;
  "network-change": NetworkChangeEvent;
  "quota-exceeded": { key: string; size: number; limit: number };
  "performance-warning": { metric: string; value: number; threshold: number };
}

export class RemoteStorage extends EventEmitter<RemoteStorageEvents> {
  private historyTransport: HttpTransport;
  private transport: ITransport;
  private connecting?: Promise<void>;
  private flushing?: Promise<void>;
  private outbox: DataStorage;
  private readonly config: RemoteStorageConfig & {
    serverUrl: string;
    instanceId: string;
    autoConnect: boolean;
    reconnection: boolean;
    timeout: number;
    retry: RetryConfig;
  };
  private localStorage: DataStorage;
  private syncQueue: Array<{ method: string; args: any[]; timestamp: number; requestId?: string }> =
    [];
  private readonly connectionInfo: ConnectionInfo;
  private conflictResolver: ConflictResolver;
  private networkManager: NetworkManager;
  private analytics: Analytics;
  private logger: Logger;
  private subscriptions = new Set<string>();
  private syncFilter?: SyncFilter;
  private syncInProgress = new Map<string, Promise<any>>();
  private remoteVersions = new Map<
    string,
    { recordId: string; version: number; timestamp: number }
  >();

  constructor(config: RemoteStorageConfig) {
    super();

    // Merge with defaults
    this.config = {
      serverUrl: config.serverUrl ?? "http://localhost:3000",
      instanceId: config.instanceId ?? generateInstanceId(),
      autoConnect: config.autoConnect ?? true,
      reconnection: config.reconnection ?? true,
      timeout: config.timeout ?? 5000,
      retry: retryConfigs.standard,
      conflict: {
        strategy: config.conflict?.strategy || ConflictStrategy.LAST_WRITE_WINS,
        autoResolve: config.conflict?.autoResolve ?? true,
        onConflict:
          config.conflict?.onConflict ||
          ((async () => {
            throw new Error("No conflict resolver provided");
          }) as (conflict: ConflictData) => Promise<any>),
        mergeStrategy: config.conflict?.mergeStrategy || MergeStrategy.DEEP_MERGE,
      },
      analytics: {
        enabled: config.analytics?.enabled ?? false,
        endpoint: config.analytics?.endpoint,
        trackPerformance: config.analytics?.trackPerformance ?? true,
        trackErrors: config.analytics?.trackErrors ?? true,
        trackUsage: config.analytics?.trackUsage ?? true,
        customEvents: config.analytics?.customEvents ?? false,
        batchSize: config.analytics?.batchSize ?? 50,
        flushInterval: config.analytics?.flushInterval ?? 30000,
      },
      storage: {
        maxSize: config.storage?.maxSize ?? 10 * 1024 * 1024, // 10MB
        compressionEnabled: config.storage?.compressionEnabled ?? false,
        encryptionKey: config.storage?.encryptionKey,
        cleanupStrategy: config.storage?.cleanupStrategy ?? "lru",
        maxItemSize: config.storage?.maxItemSize ?? 1024 * 1024, // 1MB
        ttl: config.storage?.ttl,
      },
      debug: {
        logLevel: config.debug?.logLevel ?? "info",
        performanceMonitoring: config.debug?.performanceMonitoring ?? false,
        networkLogging: config.debug?.networkLogging ?? false,
        enableDevTools: config.debug?.enableDevTools,
      },
      network: {
        backgroundSync: config.network?.backgroundSync ?? false,
        backgroundInterval: config.network?.backgroundInterval ?? 30000,
      },
      ...config,
    };

    this.transport = createTransport({
      ...this.config,
      mode: (config.mode ?? TransportMode.AUTO) as TransportMode,
    });
    this.historyTransport = new HttpTransport({ ...this.config, mode: TransportMode.HTTP });
    this.outbox = new DataStorage({
      namespace: `${config.namespace ?? "sync"}:outbox:${config.userId}`,
      maxSize: 10 * 1024 * 1024,
    });
    this.syncQueue = this.outbox.getItem<typeof this.syncQueue>("pending") ?? [];

    // Initialize logger
    this.logger = new Logger("RemoteStorage");
    this.logger.info("Initializing RemoteStorage", {
      userId: this.config.userId,
      instanceId: this.config.instanceId,
      serverUrl: this.config.serverUrl,
    });

    // Initialize connection info
    this.connectionInfo = {
      state: ConnectionState.DISCONNECTED,
      reconnectAttempts: 0,
    };

    // Initialize components
    this.localStorage = new DataStorage({
      namespace: `${this.config.namespace ?? "sync"}:${this.config.userId}`,
      maxSize: this.config.storage?.maxSize ?? 10 * 1024 * 1024,
      compressionEnabled: this.config.storage?.compressionEnabled ?? false,
      encryptionKey: this.config.storage?.encryptionKey,
      autoCleanup: true,
    });

    this.conflictResolver = new ConflictResolver(
      this.config.conflict?.strategy ?? ConflictStrategy.LAST_WRITE_WINS,
    );
    this.networkManager = new NetworkManager(
      this.config.network ?? { backgroundSync: false, backgroundInterval: 30000 },
    );
    this.analytics = new Analytics(
      this.config.analytics ?? {
        enabled: false,
        trackPerformance: true,
        trackErrors: true,
        trackUsage: true,
      },
      this.config.userId,
      this.config.instanceId,
    );

    // Set up event listeners
    this.setupEventListeners();
    this.transport.on("connect", () => this.handleConnect());
    this.transport.on("disconnect", ({ reason }) =>
      this.handleDisconnect(reason ?? "Disconnected"),
    );
    this.transport.on("error", (error) => this.handleConnectionError(error));
    this.transport.on("sync:update", (event) => {
      void this.handleRemoteUpdate(event).catch((error) => this.handleConnectionError(error));
    });
    this.transport.on("sync:remove", (event) => {
      void this.handleRemoteRemove(event);
    });
    this.transport.on("sync:conflict", (event) => {
      void this.handleConflict(event).catch((error) => this.handleConnectionError(error));
    });
    this.transport.on("pending-updates", (events) => {
      void this.handlePendingUpdates(events).catch((error) => this.handleConnectionError(error));
    });
    this.transport.on("reconnect", () => {
      void this.processSyncQueue()
        .then(() => this.syncLocalStorageItems())
        .catch((error) => this.handleConnectionError(error));
    });

    // Auto-connect if enabled
    if (this.config.autoConnect) {
      void this.connect().catch((error) => this.handleConnectionError(error));
    }

    this.logger.info("RemoteStorage initialized successfully");
  }

  /**
   * Connect to the remote server
   */
  async connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    if (this.isConnected()) return;
    this.connecting = this.transport
      .connect()
      .then(async () => {
        await this.processSyncQueue();
        await this.syncLocalStorageItems();
        await this.transport.subscribe([...this.subscriptions]);
      })
      .finally(() => {
        this.connecting = undefined;
      });
    return this.connecting;
  }

  /**
   * Set an item with conflict resolution
   */
  async setItem(key: string, value: any, metadata?: Record<string, any>): Promise<void> {
    const startTime = performance.now();

    this.logger.debug(`Setting item: ${key}`);

    // Check if sync is already in progress for this key
    while (this.syncInProgress.has(key)) {
      await this.syncInProgress.get(key);
    }

    const syncPromise = this.performSetItem(key, value, metadata);
    this.syncInProgress.set(key, syncPromise);

    try {
      await syncPromise;
    } finally {
      this.syncInProgress.delete(key);
      const duration = performance.now() - startTime;
      this.analytics.trackSync("sync:set", duration, true, { key, hasMetadata: !!metadata });
    }
  }

  /**
   * Perform the actual set operation
   */
  private async performSetItem(
    key: string,
    value: any,
    metadata?: Record<string, any>,
  ): Promise<void> {
    const timestamp = Date.now();
    const version = this.getNextVersion(key);

    // Store locally first - let DataStorage handle metadata wrapping
    const oldValue = this.localStorage.getItem(key);

    // Store just the value, with custom metadata that includes our sync info
    const customMetadata = {
      ...(metadata || {}),
      timestamp,
      version,
      syncMetadata: true,
    };

    this.localStorage.setItem(key, value, {
      metadata: customMetadata,
      ttl: metadata?.ttl ?? this.config.storage?.ttl,
    });

    // Emit local change event
    void this.emit("change", {
      key,
      oldValue,
      newValue: value,
      source: "local",
      timestamp,
      metadata,
    });

    this.queueSync("setItem", [key, value, metadata, version, timestamp]);
    if (this.isConnected()) await this.processSyncQueue();
  }

  /**
   * Get an item
   */
  getItem(key: string): any {
    const startTime = performance.now();

    try {
      const result = this.localStorage.getItem(key);
      if (result === null) return null;

      this.analytics.trackStorageOperation("get", key, undefined, true);
      // DataStorage returns the actual value directly, no need to parse
      return result;
    } catch (error) {
      this.logger.error(`Failed to get item: ${key}`, { error });
      this.analytics.trackError("storage", error as Error, { operation: "get", key });
      return null;
    } finally {
      const duration = performance.now() - startTime;
      this.analytics.trackSync("sync:get", duration, true);
    }
  }

  /**
   * Remove an item
   */
  async removeItem(key: string): Promise<void> {
    const startTime = performance.now();

    this.logger.debug(`Removing item: ${key}`);

    const oldValue = this.getItem(key);
    this.queueSync("removeItem", [key]);
    this.localStorage.removeItem(key);

    // Emit local change event
    void this.emit("change", {
      key,
      oldValue,
      newValue: null,
      source: "local",
      timestamp: Date.now(),
    });

    if (this.isConnected()) await this.processSyncQueue();

    const duration = performance.now() - startTime;
    this.analytics.trackSync("sync:remove", duration, true);
  }

  /**
   * Clear all items
   */
  async clear(): Promise<void> {
    const keys = this.getAllKeys();
    this.queueSync("clear", []);
    this.localStorage.clear();
    if (this.isConnected()) await this.processSyncQueue();

    // Emit change events for each cleared key
    keys.forEach((key) => {
      void this.emit("change", {
        key,
        oldValue: null,
        newValue: null,
        source: "local",
        timestamp: Date.now(),
      });
    });

    this.analytics.track("storage_cleared", { keysCount: keys.length });
  }

  /**
   * Get all keys
   */
  getAllKeys(): string[] {
    return this.localStorage.getAllKeys().filter((key) => {
      try {
        return this.localStorage.hasItem(key);
      } catch {
        return false;
      }
    });
  }

  /**
   * Get all items
   */
  async getAllItems(): Promise<StorageItem[]> {
    if (this.isConnected()) {
      try {
        return await this.getRemoteItems();
      } catch (error) {
        this.logger.warn("Failed to get remote items, using local", { error });
      }
    }

    const keys = this.getAllKeys();
    return keys
      .map((key) => ({
        key,
        value: this.getItem(key),
        metadata: this.getItemMetadata(key),
      }))
      .filter((item) => item.value !== null);
  }

  /**
   * Get storage length
   */
  get length(): number {
    return this.getAllKeys().length;
  }

  /**
   * Check if item exists (locally or on server)
   */
  async hasItem(key: string): Promise<boolean> {
    // First check locally
    const localExists = this.localStorage.hasItem(key);
    if (localExists) return true;

    // If not found locally and connected, check server
    if (this.isConnected()) {
      try {
        const serverItem = await this.getRemoteItem(key);
        return serverItem !== null;
      } catch (error) {
        this.logger.warn(`Failed to check item existence on server: ${key}`, { error });
      }
    }

    return false;
  }

  /**
   * Get remaining TTL for item (fetch from server if needed)
   */
  async getTTL(key: string): Promise<number> {
    // First check locally
    const localTTL = this.localStorage.getTTL(key);
    if (localTTL >= 0) return localTTL;

    // If not found locally and connected, get from server
    if (this.isConnected()) {
      try {
        const serverItem = await this.getRemoteItem(key);
        if (serverItem && serverItem.metadata?.ttl) {
          const remaining = serverItem.timestamp + serverItem.metadata.ttl - Date.now();
          return Math.max(0, remaining);
        }
      } catch (error) {
        this.logger.warn(`Failed to get TTL from server: ${key}`, { error });
      }
    }

    return -1;
  }

  /**
   * Extend TTL for item and sync with server
   */
  async extendTTL(key: string, additionalMs: number): Promise<void> {
    // Check if item exists locally
    let item = this.localStorage.getItemWithMetadata(key);

    // If not found locally but connected, try to get from server
    if (!item && this.isConnected()) {
      try {
        const serverItem = await this.getRemoteItem(key);
        if (serverItem) {
          // Store locally first
          await this.handleRemoteUpdate({
            type: "sync",
            key: serverItem.key,
            value: serverItem.value,
            metadata: serverItem.metadata,
            timestamp: serverItem.timestamp || Date.now(),
            version: serverItem.version,
            source: "remote",
          });
          item = this.localStorage.getItemWithMetadata(key);
        }
      } catch (error) {
        this.logger.warn(`Failed to fetch item from server for TTL extension: ${key}`, { error });
      }
    }

    // Extend TTL locally
    if (item) {
      const newTTL = (item.metadata.ttl || 0) + additionalMs;
      await this.setItem(key, item.value, { ...item.metadata, ttl: newTTL });
    }
  }

  /**
   * Check if storage is near capacity (considers server storage limits)
   */
  async isNearCapacity(threshold = 80): Promise<boolean> {
    // Check local capacity
    const localNearCapacity = this.localStorage.isNearCapacity(threshold);

    // If connected, also check server capacity
    if (this.isConnected()) {
      try {
        const serverCapacity = await this.getServerStorageInfo();
        if (serverCapacity && serverCapacity.usagePercentage >= threshold) {
          return true;
        }
      } catch (error) {
        this.logger.warn("Failed to check server storage capacity", { error });
      }
    }

    return localNearCapacity;
  }

  /**
   * Export data for backup (includes server data)
   */
  async export(): Promise<Record<string, any>> {
    let exportData = this.localStorage.export();

    // If connected, merge with server data
    if (this.isConnected()) {
      try {
        const serverItems = await this.getRemoteItems();
        const serverData: Record<string, any> = {};

        serverItems.forEach((item) => {
          // Only include items not already in local export
          if (!exportData.data[item.key]) {
            serverData[item.key] = {
              value: item.value,
              metadata: {
                timestamp: item.timestamp || Date.now(),
                version: item.version,
                ...item.metadata,
              },
            };
          }
        });

        // Merge server data with local export
        exportData = {
          ...exportData,
          data: { ...exportData.data, ...serverData },
          includesServerData: true,
        };
      } catch (error) {
        this.logger.warn("Failed to include server data in export", { error });
        exportData.includesServerData = false;
      }
    }

    return exportData;
  }

  /**
   * Execute batch operations
   */
  async executeBatch(operations: BatchOperation[]): Promise<BatchResult> {
    const startTime = performance.now();
    const results: BatchResult["operations"] = [];

    for (const operation of operations) {
      try {
        let result: any = undefined;

        switch (operation.type) {
          case "set":
            await this.setItem(operation.key, operation.value, operation.metadata);
            break;
          case "remove":
            await this.removeItem(operation.key);
            break;
          case "get":
            result = this.getItem(operation.key);
            break;
        }

        results.push({
          operation,
          success: true,
          result,
        });
      } catch (error) {
        results.push({
          operation,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const totalTime = performance.now() - startTime;
    this.analytics.track("batch_operation", {
      operationsCount: operations.length,
      successCount: results.filter((r) => r.success).length,
      totalTime,
    });

    return {
      success: results.every((r) => r.success),
      operations: results,
      totalTime,
    };
  }

  /**
   * Subscribe to specific keys
   */
  async subscribe(keys: string[]): Promise<void> {
    keys.forEach((key) => this.subscriptions.add(key));

    if (this.isConnected()) await this.transport.subscribe(keys);

    this.analytics.track("subscribed", { keysCount: keys.length });
  }

  /**
   * Unsubscribe from keys
   */
  async unsubscribe(keys: string[]): Promise<void> {
    keys.forEach((key) => this.subscriptions.delete(key));

    if (this.isConnected()) await this.transport.unsubscribe(keys);

    this.analytics.track("unsubscribed", { keysCount: keys.length });
  }

  /**
   * Set sync filter
   */
  setSyncFilter(filter: SyncFilter): void {
    this.syncFilter = filter;
    this.analytics.track("sync_filter_set", filter);
  }

  /**
   * Get connection info
   */
  getConnectionInfo(): ConnectionInfo {
    const quality = this.networkManager.getQuality();
    return {
      ...this.connectionInfo,
      isOnline: quality.isOnline,
    };
  }

  /**
   * Get analytics metrics
   */
  getAnalytics() {
    return this.analytics.getPerformanceMetrics();
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.transport.isConnected();
  }

  /**
   * Wait for connection
   */
  async waitForConnection(timeout?: number): Promise<void> {
    if (this.isConnected()) return;

    return new Promise((resolve, reject) => {
      timeout ??= this.config.timeout;
      const timeoutId = timeout
        ? setTimeout(() => {
            cleanup();
            reject(new Error("Connection timeout"));
          }, timeout)
        : undefined;

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        this.off("connect", onConnect);
        this.off("error", onError);
      };

      const onConnect = () => {
        cleanup();
        resolve();
      };

      const onError = (error: any) => {
        cleanup();
        reject(error.error || new Error(error.message));
      };

      this.on("connect", onConnect);
      this.on("error", onError);
    });
  }

  /**
   * Disconnect from server
   */
  disconnect(): void {
    this.transport.disconnect();
    this.connectionInfo.state = ConnectionState.DISCONNECTED;
    this.analytics.track("disconnected");
  }

  /**
   * Force sync all pending operations
   */
  async forceSync(): Promise<void> {
    if (!this.isConnected()) {
      throw new Error("Not connected to server");
    }

    await this.processSyncQueue();
    this.analytics.track("force_sync", { queueSize: this.syncQueue.length });
  }

  /** Fetch retained versions over HTTP even when live synchronization uses WebSocket. */
  async getHistory(key: string, before?: string) {
    return this.unwrap(await this.historyTransport.getHistory(key, before));
  }

  /** Preview the target version and current revision; restore requires both read and write access. */
  async previewRestore(key: string, revision: string) {
    return this.unwrap(await this.historyTransport.previewRestore(key, revision));
  }

  /** Restore online only, with an explicit request ID reusable after a lost acknowledgement. */
  async restoreVersion(
    key: string,
    revision: string,
    expected: { id: string; version: number } | null,
    requestId: string,
  ) {
    const result = this.unwrap(
      await this.historyTransport.restoreVersion(key, revision, expected, requestId),
    );
    if (this.isConnected()) await this.syncLocalStorageItems();
    return result;
  }

  // Private methods

  private setupEventListeners(): void {
    this.networkManager.on("state-change", (state) => {
      this.connectionInfo.state = state;
      void this.emit("network-change", {
        state,
        isOnline: this.networkManager.isOnline(),
        timestamp: Date.now(),
      });
    });

    // Removed complex network quality monitoring

    this.analytics.on("performance-warning", (warning) => {
      void this.emit("performance-warning", warning);
    });
  }

  private handleConnect(): void {
    this.connectionInfo.state = ConnectionState.CONNECTED;
    this.connectionInfo.connectedAt = Date.now();
    this.connectionInfo.reconnectAttempts = 0;

    void this.emit("connect", {});
    this.analytics.track("connected");
  }

  private handleDisconnect(reason: string): void {
    this.logger.debug(`Socket disconnected: ${reason}`);
    this.connectionInfo.state = ConnectionState.DISCONNECTED;

    // Only emit disconnect if we were actually connected before
    if (this.transport) {
      void this.emit("disconnect", {});
      this.analytics.track("disconnected", { reason });
    }
  }

  private handleConnectionError(error: any): void {
    this.connectionInfo.reconnectAttempts++;
    this.connectionInfo.error = error.message || String(error);

    void this.emit("error", {
      type: "connection",
      message: "Connection failed",
      error,
    });

    this.analytics.trackError("connection", error);
  }

  private async handleRemoteUpdate(data: SyncEvent): Promise<void> {
    if (!data.key || data.value === undefined || this.hasPendingKey(data.key)) return;

    // Check if this should be filtered
    if (this.syncFilter && !this.shouldSyncKey(data.key)) {
      return;
    }
    if (this.obsoleteEvent(data)) return;

    const currentValue = this.getItem(data.key);

    // Apply remote update - let DataStorage handle metadata wrapping
    const customMetadata = {
      ...(data.metadata || {}),
      timestamp: data.timestamp,
      version: data.version || 1,
      syncMetadata: true,
    };

    this.localStorage.setItem(data.key, data.value, { metadata: customMetadata });

    void this.emit("sync", data);
    void this.emit("change", {
      key: data.key,
      oldValue: currentValue,
      newValue: data.value,
      source: "remote",
      timestamp: data.timestamp,
      metadata: data.metadata,
    });
  }

  private async handleRemoteRemove(data: SyncEvent): Promise<void> {
    if (!data.key || this.hasPendingKey(data.key)) return;
    if (this.obsoleteEvent(data)) return;

    const oldValue = this.getItem(data.key);
    this.localStorage.removeItem(data.key);

    void this.emit("sync", data);
    void this.emit("change", {
      key: data.key,
      oldValue,
      newValue: null,
      source: "remote",
      timestamp: data.timestamp,
    });
  }

  /** At-least-once outbox retries must not roll back a newer value or resurrect a deletion. */
  private obsoleteEvent(data: SyncEvent): boolean {
    if (!data.key || !data.recordId || data.version === undefined) return false;
    const previous = this.remoteVersions.get(data.key);
    if (
      previous &&
      (previous.recordId === data.recordId
        ? previous.version >= data.version
        : previous.timestamp > data.timestamp)
    )
      return true;
    this.remoteVersions.set(data.key, {
      recordId: data.recordId,
      version: data.version,
      timestamp: data.timestamp,
    });
    return false;
  }

  private async handleConflict(conflictData: ConflictData): Promise<void> {
    this.analytics.track("conflict_detected", {
      key: conflictData.key,
      conflictType: conflictData.conflictType,
    });

    if (this.config.conflict?.autoResolve ?? true) {
      const resolution = await this.conflictResolver.resolve(
        conflictData,
        this.config.conflict?.strategy ?? ConflictStrategy.LAST_WRITE_WINS,
        this.config.conflict?.onConflict,
      );

      if (resolution.success && resolution.resolvedValue !== undefined) {
        await this.setItem(conflictData.key, resolution.resolvedValue);
        this.analytics.track("conflict_resolved", {
          strategy: resolution.strategy,
          confidence: resolution.confidence,
        });
      }
    } else {
      void this.emit("conflict", conflictData);
    }
  }

  private async handlePendingUpdates(updates: SyncEvent[]): Promise<void> {
    for (const update of updates) {
      if (update.type === "sync") {
        await this.handleRemoteUpdate(update);
      } else if (update.type === "remove") {
        await this.handleRemoteRemove(update);
      }
    }

    this.analytics.track("pending_updates_processed", { count: updates.length });
  }

  /** Keep failed operations in order; only acknowledged writes leave the durable outbox. */
  private async processSyncQueue(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      while (this.syncQueue.length && this.isConnected()) {
        const operation = this.syncQueue[0];
        if (!operation.requestId) {
          operation.requestId = crypto.randomUUID();
          this.outbox.setItem("pending", this.syncQueue);
        }
        const [key, value, metadata, version, timestamp] = operation.args;
        const response =
          operation.method === "clear"
            ? await this.transport.clear(operation.requestId)
            : operation.method === "removeItem"
              ? await this.transport.removeItem(key, operation.requestId)
              : await this.transport.setItem(
                  key,
                  value,
                  metadata,
                  version,
                  timestamp,
                  operation.requestId,
                );
        this.unwrap(response);
        const remaining = this.syncQueue.slice(1);
        this.outbox.setItem("pending", remaining);
        this.syncQueue = remaining;
      }
    })().finally(() => {
      this.flushing = undefined;
    });
    return this.flushing;
  }

  /** Refresh cached server data without uploading stale cache entries or resurrecting deletions. */
  private async syncLocalStorageItems(): Promise<void> {
    const items = await this.getRemoteItems();
    for (const item of items) {
      await this.handleRemoteUpdate({
        ...item,
        recordId: item.id,
        type: "sync",
        source: "remote",
        timestamp: item.timestamp ?? Date.now(),
      });
    }
    const keys = new Set(items.map((item) => item.key));
    for (const key of this.getAllKeys()) {
      if (!keys.has(key) && !this.hasPendingKey(key) && this.shouldSyncKey(key)) {
        await this.handleRemoteRemove({
          key,
          type: "remove",
          source: "remote",
          timestamp: Date.now(),
        });
      }
    }
  }

  /** Persist pending changes before reporting them as queued; never silently truncate writes. */
  private queueSync(method: string, args: any[]): void {
    const queue = [
      ...this.syncQueue,
      { method, args, timestamp: Date.now(), requestId: crypto.randomUUID() },
    ];
    this.outbox.setItem("pending", queue);
    this.syncQueue = queue;
  }

  /** Protect locally pending values from older remote events. */
  private hasPendingKey(key: string): boolean {
    return this.syncQueue.some(
      (operation) => operation.method === "clear" || operation.args[0] === key,
    );
  }

  /** Surface transport failures instead of treating rejected requests as successful writes. */
  private unwrap<T>(response: TransportResponse<T>): T {
    if (!response.success) throw new Error(response.error ?? "Sync request failed");
    return response.data as T;
  }

  private async getRemoteItems(): Promise<StorageItem[]> {
    return this.unwrap(await this.transport.getAllItems()).filter((item) =>
      this.shouldSyncKey(item.key),
    );
  }

  private async getRemoteItem(key: string): Promise<StorageItem | null> {
    return this.unwrap(await this.transport.getItem(key));
  }

  private async getServerStorageInfo() {
    return this.unwrap(await this.transport.getStorageInfo());
  }

  private shouldSyncKey(key: string): boolean {
    if (!this.syncFilter) return true;

    // Check include patterns
    if (this.syncFilter.includePatterns) {
      const included = this.syncFilter.includePatterns.some((pattern) =>
        new RegExp(pattern).test(key),
      );
      if (!included) return false;
    }

    // Check exclude patterns
    if (this.syncFilter.excludePatterns) {
      const excluded = this.syncFilter.excludePatterns.some((pattern) =>
        new RegExp(pattern).test(key),
      );
      if (excluded) return false;
    }

    return true;
  }

  private getItemMetadata(key: string): Record<string, any> | undefined {
    try {
      const metadata = this.localStorage.getItemMetadata(key);
      if (!metadata || !metadata.syncMetadata) return undefined;

      // Return the custom metadata we stored, excluding internal sync fields
      const {
        timestamp: _timestamp,
        version: _version,
        syncMetadata: _syncMetadata,
        ...userMetadata
      } = metadata;
      return userMetadata;
    } catch {
      return undefined;
    }
  }

  private getNextVersion(key: string): number {
    return this.getCurrentVersion(key) + 1;
  }

  private getCurrentVersion(key: string): number {
    try {
      const metadata = this.localStorage.getItemMetadata(key);
      if (!metadata || !metadata.syncMetadata) return 0;

      return metadata.version || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.disconnect();
    this.transport.destroy();
    this.historyTransport.destroy();
    this.outbox.destroy();
    this.networkManager.destroy();
    this.analytics.destroy();
    this.localStorage.destroy();
    this.removeAllListeners();

    this.logger.info("RemoteStorage destroyed");
  }
}
