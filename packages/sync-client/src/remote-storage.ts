import { io, Socket } from "socket.io-client";
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
import { EnhancedStorage } from "./utils/storage";
import { Logger } from "./utils/logger";
import { retry, retryConfigs, withTimeout } from "./utils/retry";
import { generateInstanceId, generateUniqueId } from "./utils";

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

/**
 * Enhanced RemoteStorage with comprehensive sync capabilities
 */
export class RemoteStorage extends EventEmitter<RemoteStorageEvents> {
  private socket: Socket | null = null;
  private readonly config: RemoteStorageConfig & {
    serverUrl: string;
    instanceId: string;
    autoConnect: boolean;
    reconnection: boolean;
    timeout: number;
    retry: RetryConfig;
  };
  private localStorage: EnhancedStorage;
  private syncQueue: Array<{ method: string; args: any[]; timestamp: number }> = [];
  private connectionInfo: ConnectionInfo;
  private conflictResolver: ConflictResolver;
  private networkManager: NetworkManager;
  private analytics: Analytics;
  private logger: Logger;
  private subscriptions = new Set<string>();
  private syncFilter?: SyncFilter;
  private syncInProgress = new Map<string, Promise<any>>();

  constructor(config: RemoteStorageConfig) {
    super();

    // Merge with defaults
    this.config = {
      serverUrl: "http://localhost:3000",
      instanceId: generateInstanceId(),
      autoConnect: true,
      reconnection: true,
      timeout: 5000,
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
    this.localStorage = new EnhancedStorage({
      namespace: `sync:${this.config.userId}`,
      maxSize: this.config.storage?.maxSize ?? 10 * 1024 * 1024,
      compressionEnabled: this.config.storage?.compressionEnabled ?? false,
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

    // Auto-connect if enabled
    if (this.config.autoConnect) {
      void this.connect();
    }

    this.logger.info("RemoteStorage initialized successfully");
  }

  /**
   * Connect to the remote server
   */
  async connect(): Promise<void> {
    if (this.socket?.connected) {
      this.logger.debug("Already connected");
      return;
    }

    this.logger.info("Connecting to server", { serverUrl: this.config.serverUrl });
    this.connectionInfo.state = ConnectionState.CONNECTING;
    this.analytics.track("connection_attempt");

    const connectWithRetry = retry(() => this.establishConnection(), this.config.retry);

    try {
      await connectWithRetry;
      this.logger.info("Successfully connected to server");
    } catch (error) {
      this.logger.error("Failed to connect after retries", { error });
      this.connectionInfo.state = ConnectionState.ERROR;
      this.connectionInfo.error = error instanceof Error ? error.message : String(error);
      this.analytics.trackError("connection", error as Error);
      throw error;
    }
  }

  /**
   * Establish socket connection
   */
  private establishConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.socket = io(`${this.config.serverUrl}/sync`, {
          query: {
            userId: this.config.userId,
            instanceId: this.config.instanceId,
            apiKey: this.config.apiKey,
          },
          timeout: this.config.timeout,
          reconnection: this.config.reconnection,
          forceNew: true,
        });

        const timeoutId = setTimeout(() => {
          reject(new Error("Connection timeout"));
        }, this.config.timeout);

        this.socket.on("connect", () => {
          clearTimeout(timeoutId);
          this.handleConnect();
          resolve();
        });

        this.socket.on("connect_error", (error) => {
          clearTimeout(timeoutId);
          this.handleConnectionError(error);
          reject(error);
        });

        this.setupSocketListeners();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Set up socket event listeners
   */
  private setupSocketListeners(): void {
    if (!this.socket) return;

    this.socket.on("sync:update", (data: SyncEvent) => {
      void this.handleRemoteUpdate(data);
    });

    this.socket.on("sync:remove", (data: SyncEvent) => {
      void this.handleRemoteRemove(data);
    });

    this.socket.on("sync:conflict", (conflictData: ConflictData) => {
      void this.handleConflict(conflictData);
    });

    this.socket.on("pending-updates", (updates: SyncEvent[]) => {
      void this.handlePendingUpdates(updates);
    });

    this.socket.on("disconnect", (reason) => {
      this.handleDisconnect(reason);
    });

    this.socket.on("reconnect", () => {
      this.handleReconnect();
    });

    this.socket.on("error", (error) => {
      this.handleSocketError(error);
    });
  }

  /**
   * Set an item with conflict resolution
   */
  async setItem(key: string, value: any, metadata?: Record<string, any>): Promise<void> {
    const startTime = performance.now();

    this.logger.debug(`Setting item: ${key}`);

    // Check if sync is already in progress for this key
    if (this.syncInProgress.has(key)) {
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

    // Store locally first
    const storageData = {
      value,
      metadata: metadata || {},
      timestamp,
      version,
    };

    const oldValue = this.localStorage.getItem(key);
    this.localStorage.setItem(key, JSON.stringify(storageData));

    // Emit local change event
    this.emit("change", {
      key,
      oldValue,
      newValue: value,
      source: "local",
      timestamp,
      metadata,
    });

    // Sync to remote if connected
    if (this.isConnected()) {
      try {
        await withTimeout(
          this.syncToRemote("set", key, value, metadata, version, timestamp),
          this.config.timeout,
        );
      } catch (error) {
        this.logger.warn(`Failed to sync to remote: ${key}`, { error });
        this.queueSync("setItem", [key, value, metadata]);
        this.analytics.trackError("sync", error as Error, { operation: "set", key });
      }
    } else {
      this.queueSync("setItem", [key, value, metadata]);
    }
  }

  /**
   * Get an item
   */
  getItem(key: string): any {
    const startTime = performance.now();

    try {
      const stored = this.localStorage.getItem(key);
      if (!stored) return null;

      const data = JSON.parse(stored as string);

      this.analytics.trackStorageOperation("get", key, undefined, true);
      return data.value;
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
    this.localStorage.removeItem(key);

    // Emit local change event
    this.emit("change", {
      key,
      oldValue,
      newValue: null,
      source: "local",
      timestamp: Date.now(),
    });

    // Sync to remote if connected
    if (this.isConnected()) {
      try {
        await withTimeout(this.syncToRemote("remove", key), this.config.timeout);
      } catch (error) {
        this.logger.warn(`Failed to sync removal to remote: ${key}`, { error });
        this.queueSync("removeItem", [key]);
        this.analytics.trackError("sync", error as Error, { operation: "remove", key });
      }
    } else {
      this.queueSync("removeItem", [key]);
    }

    const duration = performance.now() - startTime;
    this.analytics.trackSync("sync:remove", duration, true);
  }

  /**
   * Clear all items
   */
  clear(): void {
    const keys = this.getAllKeys();
    this.localStorage.clear();

    // Emit change events for each cleared key
    keys.forEach((key) => {
      this.emit("change", {
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
        const stored = this.localStorage.getItem(key);
        return stored !== null;
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

    if (this.isConnected() && this.socket) {
      this.socket.emit("sync:subscribe", {
        keys,
        userId: this.config.userId,
        instanceId: this.config.instanceId,
      });
    }

    this.analytics.track("subscribed", { keysCount: keys.length });
  }

  /**
   * Unsubscribe from keys
   */
  async unsubscribe(keys: string[]): Promise<void> {
    keys.forEach((key) => this.subscriptions.delete(key));

    if (this.isConnected() && this.socket) {
      this.socket.emit("sync:unsubscribe", {
        keys,
        userId: this.config.userId,
      });
    }

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
    return this.socket?.connected === true;
  }

  /**
   * Wait for connection
   */
  async waitForConnection(timeout?: number): Promise<void> {
    if (this.isConnected()) return;

    return new Promise((resolve, reject) => {
      const timeoutId = timeout
        ? setTimeout(() => {
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
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
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

  // Private methods

  private setupEventListeners(): void {
    this.networkManager.on("state-change", (state) => {
      this.connectionInfo.state = state;
      this.emit("network-change", {
        state,
        isOnline: this.networkManager.isOnline(),
        timestamp: Date.now(),
      });
    });

    // Removed complex network quality monitoring

    this.analytics.on("performance-warning", (warning) => {
      this.emit("performance-warning", warning);
    });
  }

  private handleConnect(): void {
    this.connectionInfo.state = ConnectionState.CONNECTED;
    this.connectionInfo.connectedAt = Date.now();
    this.connectionInfo.reconnectAttempts = 0;

    void this.processSyncQueue();
    this.emit("connect", {});
    this.analytics.track("connected");
  }

  private handleDisconnect(reason: string): void {
    this.connectionInfo.state = ConnectionState.DISCONNECTED;
    this.emit("disconnect", {});
    this.analytics.track("disconnected", { reason });
  }

  private handleReconnect(): void {
    this.connectionInfo.state = ConnectionState.CONNECTED;
    this.connectionInfo.reconnectAttempts = 0;

    void this.processSyncQueue();
    this.emit("reconnect", {});
    this.analytics.track("reconnected");
  }

  private handleConnectionError(error: any): void {
    this.connectionInfo.reconnectAttempts++;
    this.connectionInfo.error = error.message || String(error);

    this.emit("error", {
      type: "connection",
      message: "Connection failed",
      error,
    });

    this.analytics.trackError("connection", error);
  }

  private handleSocketError(error: any): void {
    this.emit("error", {
      type: "socket",
      message: "Socket error",
      error,
    });

    this.analytics.trackError("socket", error);
  }

  private async handleRemoteUpdate(data: SyncEvent): Promise<void> {
    if (!data.key || data.value === undefined) return;

    // Check if this should be filtered
    if (this.syncFilter && !this.shouldSyncKey(data.key)) {
      return;
    }

    const currentValue = this.getItem(data.key);

    // Check for conflicts
    if (currentValue !== null && JSON.stringify(currentValue) !== JSON.stringify(data.value)) {
      if (this.config.conflict?.autoResolve ?? true) {
        await this.resolveConflictAutomatically(data.key, currentValue, data.value, data);
      } else {
        const conflictData: ConflictData = {
          id: generateUniqueId(),
          key: data.key,
          localValue: currentValue,
          remoteValue: data.value,
          localVersion: this.getCurrentVersion(data.key),
          remoteVersion: data.version || 1,
          localTimestamp: Date.now(),
          remoteTimestamp: data.timestamp,
          conflictType: "concurrent_update",
          metadata: data.metadata,
        };

        this.emit("conflict", conflictData);
        return;
      }
    }

    // Apply remote update
    this.localStorage.setItem(
      data.key,
      JSON.stringify({
        value: data.value,
        metadata: data.metadata || {},
        timestamp: data.timestamp,
        version: data.version || 1,
      }),
    );

    this.emit("sync", data);
    this.emit("change", {
      key: data.key,
      oldValue: currentValue,
      newValue: data.value,
      source: "remote",
      timestamp: data.timestamp,
      metadata: data.metadata,
    });
  }

  private async handleRemoteRemove(data: SyncEvent): Promise<void> {
    if (!data.key) return;

    const oldValue = this.getItem(data.key);
    this.localStorage.removeItem(data.key);

    this.emit("sync", data);
    this.emit("change", {
      key: data.key,
      oldValue,
      newValue: null,
      source: "remote",
      timestamp: data.timestamp,
    });
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
      this.emit("conflict", conflictData);
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

  private async resolveConflictAutomatically(
    key: string,
    localValue: any,
    remoteValue: any,
    syncEvent: SyncEvent,
  ): Promise<void> {
    const conflictData: ConflictData = {
      id: generateUniqueId(),
      key,
      localValue,
      remoteValue,
      localVersion: this.getCurrentVersion(key),
      remoteVersion: syncEvent.version || 1,
      localTimestamp: Date.now(),
      remoteTimestamp: syncEvent.timestamp,
      conflictType: "concurrent_update",
      metadata: syncEvent.metadata,
    };

    const resolution = await this.conflictResolver.resolve(
      conflictData,
      this.config.conflict?.strategy ?? ConflictStrategy.LAST_WRITE_WINS,
    );

    if (resolution.success && resolution.resolvedValue !== undefined) {
      this.localStorage.setItem(
        key,
        JSON.stringify({
          value: resolution.resolvedValue,
          metadata: syncEvent.metadata || {},
          timestamp: Date.now(),
          version: Math.max(conflictData.localVersion, conflictData.remoteVersion) + 1,
        }),
      );

      this.analytics.track("conflict_auto_resolved", {
        strategy: resolution.strategy,
        confidence: resolution.confidence,
      });
    }
  }

  private async processSyncQueue(): Promise<void> {
    if (this.syncQueue.length === 0) return;

    const queue = [...this.syncQueue];
    this.syncQueue = [];

    for (const { method, args } of queue) {
      try {
        switch (method) {
          case "setItem":
            await this.setItem(args[0], args[1], args[2]);
            break;
          case "removeItem":
            await this.removeItem(args[0]);
            break;
        }
      } catch (error) {
        this.logger.error(`Failed to process queued sync: ${method}`, { error, args });
        // Re-queue failed operations
        this.queueSync(method, args);
      }
    }
  }

  private queueSync(method: string, args: any[]): void {
    this.syncQueue.push({
      method,
      args,
      timestamp: Date.now(),
    });

    // Prevent queue from growing too large
    if (this.syncQueue.length > 1000) {
      this.syncQueue = this.syncQueue.slice(-500); // Keep latest 500
      this.logger.warn("Sync queue was truncated due to size");
    }
  }

  private async syncToRemote(
    operation: string,
    key: string,
    value?: any,
    metadata?: Record<string, any>,
    version?: number,
    timestamp?: number,
  ): Promise<void> {
    if (!this.socket) throw new Error("Not connected");

    return new Promise((resolve, reject) => {
      const eventData = {
        type: operation,
        key,
        value,
        metadata,
        userId: this.config.userId,
        instanceId: this.config.instanceId,
        version,
        timestamp: timestamp || Date.now(),
      };

      this.socket!.emit(`sync:${operation}`, eventData, (response: any) => {
        if (response?.type === "error") {
          reject(new Error(response.error));
        } else {
          resolve();
        }
      });
    });
  }

  private async getRemoteItems(): Promise<StorageItem[]> {
    if (!this.socket) throw new Error("Not connected");

    return new Promise((resolve, reject) => {
      this.socket!.emit(
        "sync:getAll",
        {
          userId: this.config.userId,
          instanceId: this.config.instanceId,
          filter: this.syncFilter,
        },
        (response: any) => {
          if (response?.type === "error") {
            reject(new Error(response.error));
          } else {
            resolve(response.items || []);
          }
        },
      );
    });
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
      const stored = this.localStorage.getItem(key);
      if (!stored) return undefined;

      const data = JSON.parse(stored as string);
      return data.metadata;
    } catch {
      return undefined;
    }
  }

  private getNextVersion(key: string): number {
    return this.getCurrentVersion(key) + 1;
  }

  private getCurrentVersion(key: string): number {
    try {
      const stored = this.localStorage.getItem(key);
      if (!stored) return 0;

      const data = JSON.parse(stored as string);
      return data.version || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.disconnect();
    this.networkManager.destroy();
    this.analytics.destroy();
    this.localStorage.destroy();
    this.removeAllListeners();

    this.logger.info("RemoteStorage destroyed");
  }
}
