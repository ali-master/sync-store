import { io, Socket } from "socket.io-client";
import { BaseTransport } from "./base-transport";
import { withTimeout } from "../utils/retry";
import type { TransportConfig, TransportResponse, StorageInfo } from "./types";
import { TransportState, TransportMode } from "./types";
import type {
  StorageItem,
  SyncFilter,
  BatchOperation,
  BatchResult,
  SyncEvent,
  ConflictData,
} from "../types";

/**
 * WebSocket transport implementation for sync client
 *
 * This transport uses Socket.IO for real-time bidirectional communication
 * with the server. It provides full CRUD operations, batch processing,
 * and real-time event streaming capabilities. When used in strict mode
 * (mode: "websocket"), it will not attempt HTTP fallback even if the
 * WebSocket connection fails.
 *
 * @class WebSocketTransport
 * @extends {BaseTransport}
 */
export class WebSocketTransport extends BaseTransport {
  /**
   * Socket.IO client instance
   * @private
   */
  private socket: Socket | null = null;

  /**
   * Reconnection attempt counter
   * @private
   */
  private reconnectAttempts = 0;

  /**
   * Maximum reconnection attempts
   * @private
   */
  private readonly maxReconnectAttempts = 5;

  /**
   * Creates a new WebSocket transport instance
   *
   * @param {TransportConfig} config - Transport configuration
   */
  constructor(config: TransportConfig) {
    super(config, "WebSocket");

    this.logger.info("WebSocket transport initialized", {
      serverUrl: config.serverUrl,
      userId: config.userId,
    });
  }

  /**
   * Connect to the server via WebSocket
   *
   * @returns {Promise<void>}
   * @throws {Error} If connection fails
   */
  async connect(): Promise<void> {
    if (this.isConnected()) {
      this.logger.debug("Already connected");
      return;
    }

    // Clean up existing socket if disconnected
    if (this.socket && !this.socket.connected) {
      this.socket.disconnect();
      this.socket = null;
    }

    this.setState(TransportState.CONNECTING);
    const startTime = Date.now();

    try {
      await this.establishConnection();
      this.trackRequest(startTime, true);
      this.logger.info("Connected to server via WebSocket");
    } catch (error) {
      this.trackRequest(startTime, false);
      this.handleError(error as Error, "WebSocket connection failed");
      throw error;
    }
  }

  /**
   * Establish WebSocket connection
   *
   * @private
   * @returns {Promise<void>}
   */
  private establishConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const url = new URL(this.config.serverUrl);
        const socketUrl = `${url.protocol}//${url.host}`;

        this.socket = io(`${socketUrl}/sync`, {
          query: {
            userId: this.config.userId,
            instanceId: this.config.instanceId,
            "api-key": this.config.apiKey,
          },
          timeout: this.config.timeout || 5000,
          reconnection: this.config.reconnection !== false,
          reconnectionAttempts: this.maxReconnectAttempts,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
          forceNew: true,
        });

        const timeoutId = setTimeout(() => {
          reject(new Error("Connection timeout"));
        }, this.config.timeout || 5000);

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
   * Set up WebSocket event listeners
   *
   * @private
   */
  private setupSocketListeners(): void {
    if (!this.socket) return;

    // Sync events - match server event names
    this.socket.on("sync:update", (data: SyncEvent) => {
      this.emit("sync:update", data);
    });

    this.socket.on("sync:remove", (data: SyncEvent) => {
      this.emit("sync:remove", data);
    });

    this.socket.on("sync:conflict", (data: ConflictData) => {
      this.emit("sync:conflict", data);
    });

    this.socket.on("pending-updates", (updates: SyncEvent[]) => {
      this.emit("pending-updates", updates);
    });

    this.socket.on("storage:quota-exceeded", (data: any) => {
      this.emit("error", {
        type: "quota",
        message: "Storage quota exceeded",
        error: data,
      });
    });

    this.socket.on("sync:complete", (data: any) => {
      this.logger.debug("Sync operation completed", data);
    });

    // Connection events
    this.socket.on("disconnect", (reason) => {
      this.handleDisconnect(reason);
    });

    this.socket.on("reconnect", (attemptNumber) => {
      this.handleReconnect(attemptNumber);
    });

    this.socket.on("reconnect_attempt", (attemptNumber) => {
      this.setState(TransportState.RECONNECTING);
      this.emit("reconnect", { attempt: attemptNumber });
    });

    this.socket.on("error", (error) => {
      this.handleSocketError(error);
    });
  }

  /**
   * Handle successful connection
   *
   * @private
   */
  private handleConnect(): void {
    this.setState(TransportState.CONNECTED);
    this.reconnectAttempts = 0;
    this.emit("connect", undefined);
    this.logger.debug("WebSocket connected");
  }

  /**
   * Handle disconnection
   *
   * @private
   * @param {string} reason - Disconnect reason
   */
  private handleDisconnect(reason: string): void {
    this.setState(TransportState.DISCONNECTED);
    this.emit("disconnect", { reason });
    this.logger.debug(`WebSocket disconnected: ${reason}`);
  }

  /**
   * Handle reconnection
   *
   * @private
   * @param {number} attemptNumber - Reconnection attempt number
   */
  private handleReconnect(attemptNumber: number): void {
    this.setState(TransportState.CONNECTED);
    this.reconnectAttempts = 0;
    this.emit("connect", undefined);
    this.logger.info(`WebSocket reconnected after ${attemptNumber} attempts`);
  }

  /**
   * Handle connection error
   *
   * @private
   * @param {Error} error - Connection error
   */
  private handleConnectionError(error: Error): void {
    this.reconnectAttempts++;
    this.logger.error("WebSocket connection error", {
      error: error.message,
      attempts: this.reconnectAttempts,
    });

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setState(TransportState.ERROR);
    }
  }

  /**
   * Handle socket error
   *
   * @private
   * @param {any} error - Socket error
   */
  private handleSocketError(error: any): void {
    this.emit("error", {
      type: "socket",
      message: "Socket error",
      error,
    });
    this.logger.error("Socket error", { error });
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.setState(TransportState.DISCONNECTED);
    this.logger.info("WebSocket disconnected");
  }

  /**
   * Set an item on the server
   *
   * @param {string} key - Storage key
   * @param {any} value - Value to store
   * @param {Record<string, any>} [metadata] - Optional metadata
   * @param {number} [version] - Optional version
   * @param {number} [timestamp] - Optional timestamp
   * @returns {Promise<TransportResponse>}
   */
  async setItem(
    key: string,
    value: any,
    metadata?: Record<string, any>,
    version?: number,
    timestamp?: number,
  ): Promise<TransportResponse> {
    if (!this.socket) {
      return { success: false, error: "Not connected" };
    }

    const startTime = Date.now();

    return new Promise((resolve) => {
      const eventData = {
        type: "set",
        key,
        value,
        metadata,
        userId: this.config.userId,
        instanceId: this.config.instanceId,
        version,
        timestamp: timestamp || Date.now(),
      };

      this.socket!.emit("sync:set", eventData, (response: any) => {
        const success = response?.type !== "error" && !response?.error;
        this.trackRequest(startTime, success, JSON.stringify(value).length);

        if (success) {
          this.logger.debug(`Item set via WebSocket: ${key}`);
          resolve({
            success: true,
            data: {
              key,
              value: response?.value || value,
              version: response?.version,
              timestamp: response?.timestamp || Date.now(),
              metadata: response?.metadata || metadata,
            },
          });
        } else {
          resolve({
            success: false,
            error: response?.error || "Set operation failed",
          });
        }
      });
    });
  }

  /**
   * Get an item from the server
   *
   * @param {string} key - Storage key
   * @returns {Promise<TransportResponse<StorageItem | null>>}
   */
  async getItem(key: string): Promise<TransportResponse<StorageItem | null>> {
    if (!this.socket) {
      return { success: false, error: "Not connected" };
    }

    const startTime = Date.now();

    return new Promise((resolve) => {
      this.socket!.emit(
        "sync:get",
        {
          key,
          userId: this.config.userId,
          instanceId: this.config.instanceId,
        },
        (response: any) => {
          const success = response?.type !== "error" && !response?.error;
          this.trackRequest(startTime, success);

          if (success) {
            this.logger.debug(`Item retrieved via WebSocket: ${key}`);
            resolve({
              success: true,
              data:
                response?.value !== undefined
                  ? {
                      key,
                      value: response.value,
                      version: response.version,
                      timestamp: response.timestamp,
                      metadata: response.metadata,
                    }
                  : null,
            });
          } else {
            resolve({
              success: false,
              error: response?.error || "Get operation failed",
            });
          }
        },
      );
    });
  }

  /**
   * Remove an item from the server
   *
   * @param {string} key - Storage key
   * @returns {Promise<TransportResponse>}
   */
  async removeItem(key: string): Promise<TransportResponse> {
    if (!this.socket) {
      return { success: false, error: "Not connected" };
    }

    const startTime = Date.now();

    return new Promise((resolve) => {
      this.socket!.emit(
        "sync:remove",
        {
          key,
          userId: this.config.userId,
          instanceId: this.config.instanceId,
          timestamp: Date.now(),
        },
        (response: any) => {
          const success = response?.type !== "error" && !response?.error;
          this.trackRequest(startTime, success);

          if (success) {
            this.logger.debug(`Item removed via WebSocket: ${key}`);
            resolve({ success: true, data: response });
          } else {
            resolve({
              success: false,
              error: response?.error || "Remove operation failed",
            });
          }
        },
      );
    });
  }

  /**
   * Get all items from the server
   *
   * @param {SyncFilter} [filter] - Optional filter
   * @returns {Promise<TransportResponse<StorageItem[]>>}
   */
  async getAllItems(filter?: SyncFilter): Promise<TransportResponse<StorageItem[]>> {
    if (!this.socket) {
      return { success: false, error: "Not connected" };
    }

    const startTime = Date.now();

    return new Promise((resolve) => {
      this.socket!.emit(
        "sync:getAll",
        {
          userId: this.config.userId,
          instanceId: this.config.instanceId,
          filter,
        },
        (response: any) => {
          const success = response?.type !== "error" && !response?.error;
          this.trackRequest(startTime, success);

          if (success) {
            const items = Array.isArray(response?.items)
              ? response.items
              : Array.isArray(response)
                ? response
                : [];
            this.logger.debug(`Retrieved ${items.length} items via WebSocket`);
            resolve({
              success: true,
              data: items,
            });
          } else {
            resolve({
              success: false,
              error: response?.error || "GetAll operation failed",
            });
          }
        },
      );
    });
  }

  /**
   * Execute batch operations
   *
   * @param {BatchOperation[]} operations - Operations to execute
   * @returns {Promise<TransportResponse<BatchResult>>}
   */
  async executeBatch(operations: BatchOperation[]): Promise<TransportResponse<BatchResult>> {
    if (!this.socket) {
      return { success: false, error: "Not connected" };
    }

    const startTime = Date.now();

    return new Promise((resolve) => {
      // Server doesn't have batch endpoint, execute operations sequentially
      const results: any[] = [];
      let completed = 0;

      const executeNextOperation = () => {
        if (completed >= operations.length) {
          const successCount = results.filter((r) => r.success).length;
          this.trackRequest(startTime, true);
          this.logger.debug(
            `Batch executed via WebSocket: ${successCount}/${operations.length} succeeded`,
          );
          resolve({
            success: true,
            data: {
              success: true,
              operations: results.map((r) => ({
                operation: operations.find((op) => op.key === r.key) || operations[0],
                success: r.success,
                error: r.error,
                result: r.data,
              })),
              totalTime: Date.now() - startTime,
            } as BatchResult,
          });
          return;
        }

        const operation = operations[completed];

        // Execute individual operation
        const executeOperation = async () => {
          try {
            let result;
            switch (operation.type) {
              case "set":
                result = await this.setItem(operation.key, operation.value, operation.metadata);
                break;
              case "get":
                result = await this.getItem(operation.key);
                break;
              case "remove":
                result = await this.removeItem(operation.key);
                break;
              default:
                result = { success: false, error: `Unknown operation type: ${operation.type}` };
            }
            results.push({ ...operation, ...result });
          } catch (error) {
            results.push({ ...operation, success: false, error: (error as Error).message });
          }

          completed++;
          executeNextOperation();
        };

        executeOperation();
      };

      executeNextOperation();
    });
  }

  /**
   * Get all storage keys
   *
   * @param {string} [prefix] - Optional prefix filter
   * @returns {Promise<TransportResponse<string[]>>}
   */
  async getKeys(prefix?: string): Promise<TransportResponse<string[]>> {
    if (!this.socket) {
      return { success: false, error: "Not connected" };
    }

    const startTime = Date.now();

    return new Promise((resolve) => {
      this.socket!.emit(
        "sync:getKeys",
        {
          userId: this.config.userId,
          instanceId: this.config.instanceId,
          prefix,
        },
        (response: any) => {
          const success = response?.type !== "error" && !response?.error;
          this.trackRequest(startTime, success);

          if (success) {
            const keys = Array.isArray(response?.keys)
              ? response.keys
              : Array.isArray(response)
                ? response
                : [];
            this.logger.debug(`Retrieved ${keys.length} keys via WebSocket`);
            resolve({
              success: true,
              data: keys,
            });
          } else {
            resolve({
              success: false,
              error: response?.error || "GetKeys operation failed",
            });
          }
        },
      );
    });
  }

  /**
   * Clear all storage for the user
   *
   * @returns {Promise<TransportResponse>}
   */
  async clear(): Promise<TransportResponse> {
    if (!this.socket) {
      return { success: false, error: "Not connected" };
    }

    const startTime = Date.now();

    return new Promise((resolve) => {
      this.socket!.emit(
        "sync:clear",
        {
          userId: this.config.userId,
          instanceId: this.config.instanceId,
        },
        (response: any) => {
          const success = response?.type !== "error" && !response?.error;
          this.trackRequest(startTime, success);

          if (success) {
            this.logger.debug("Storage cleared via WebSocket");
            resolve({ success: true, data: response });
          } else {
            resolve({
              success: false,
              error: response?.error || "Clear operation failed",
            });
          }
        },
      );
    });
  }

  /**
   * Get server storage information
   *
   * @returns {Promise<TransportResponse<StorageInfo>>}
   */
  async getStorageInfo(): Promise<TransportResponse<StorageInfo>> {
    if (!this.socket) {
      return { success: false, error: "Not connected" };
    }

    const startTime = Date.now();

    return new Promise((resolve) => {
      this.socket!.emit(
        "sync:storageInfo",
        {
          userId: this.config.userId,
          instanceId: this.config.instanceId,
        },
        (response: any) => {
          const success = response?.type !== "error" && !response?.error;
          this.trackRequest(startTime, success);

          if (success) {
            const storageInfo = response?.storageInfo ||
              response || {
                totalItems: 0,
                totalUsers: 1,
                storageSize: 0,
                deletedItems: 0,
                lastSyncTime: Date.now(),
                serverVersion: "1.0.0",
              };
            this.logger.debug("Storage info retrieved via WebSocket", storageInfo);
            resolve({
              success: true,
              data: storageInfo,
            });
          } else {
            resolve({
              success: false,
              error: response?.error || "Storage info request failed",
            });
          }
        },
      );
    });
  }

  /**
   * Get conflict history for a storage item
   *
   * @param {string} itemId - The item ID to get conflict history for
   * @returns {Promise<TransportResponse>}
   */
  async getConflictHistory(itemId: string): Promise<TransportResponse> {
    if (!this.socket) {
      return { success: false, error: "Not connected" };
    }

    const startTime = Date.now();

    return new Promise((resolve) => {
      this.socket!.emit(
        "conflict:getHistory",
        {
          itemId,
          userId: this.config.userId,
          instanceId: this.config.instanceId,
        },
        (response: any) => {
          const success = response?.type !== "error" && !response?.error;
          this.trackRequest(startTime, success);

          if (success) {
            this.logger.debug(`Retrieved conflict history for item: ${itemId} via WebSocket`);
            resolve({ success: true, data: response });
          } else {
            resolve({
              success: false,
              error: response?.error || "Get conflict history failed",
            });
          }
        },
      );
    });
  }

  /**
   * Get conflict statistics for the current user
   *
   * @param {Date} [startDate] - Start date for statistics
   * @param {Date} [endDate] - End date for statistics
   * @returns {Promise<TransportResponse>}
   */
  async getConflictStats(startDate?: Date, endDate?: Date): Promise<TransportResponse> {
    if (!this.socket) {
      return { success: false, error: "Not connected" };
    }

    const startTime = Date.now();

    return new Promise((resolve) => {
      this.socket!.emit(
        "conflict:getStats",
        {
          userId: this.config.userId,
          instanceId: this.config.instanceId,
          startDate: startDate?.toISOString(),
          endDate: endDate?.toISOString(),
        },
        (response: any) => {
          const success = response?.type !== "error" && !response?.error;
          this.trackRequest(startTime, success);

          if (success) {
            this.logger.debug("Retrieved conflict statistics via WebSocket");
            resolve({ success: true, data: response });
          } else {
            resolve({
              success: false,
              error: response?.error || "Get conflict stats failed",
            });
          }
        },
      );
    });
  }

  /**
   * Resolve a specific conflict
   *
   * @param {string} conflictId - The conflict ID to resolve
   * @param {any} resolveDto - The resolution strategy and options
   * @returns {Promise<TransportResponse>}
   */
  async resolveConflict(conflictId: string, resolveDto: any): Promise<TransportResponse> {
    if (!this.socket) {
      return { success: false, error: "Not connected" };
    }

    const startTime = Date.now();

    return new Promise((resolve) => {
      this.socket!.emit(
        "conflict:resolve",
        {
          conflictId,
          ...resolveDto,
          userId: this.config.userId,
          instanceId: this.config.instanceId,
        },
        (response: any) => {
          const success = response?.type !== "error" && !response?.error;
          this.trackRequest(startTime, success);

          if (success) {
            this.logger.debug(`Resolved conflict: ${conflictId} via WebSocket`);
            resolve({ success: true, data: response });
          } else {
            resolve({
              success: false,
              error: response?.error || "Resolve conflict failed",
            });
          }
        },
      );
    });
  }

  /**
   * Analyze potential conflicts for given data
   *
   * @param {any} data - The data to analyze for conflicts
   * @returns {Promise<TransportResponse>}
   */
  async analyzeConflict(data: any): Promise<TransportResponse> {
    if (!this.socket) {
      return { success: false, error: "Not connected" };
    }

    const startTime = Date.now();

    return new Promise((resolve) => {
      this.socket!.emit(
        "conflict:analyze",
        {
          ...data,
          userId: this.config.userId,
          instanceId: this.config.instanceId,
        },
        (response: any) => {
          const success = response?.type !== "error" && !response?.error;
          this.trackRequest(startTime, success);

          if (success) {
            this.logger.debug("Analyzed conflict for data via WebSocket");
            resolve({ success: true, data: response });
          } else {
            resolve({
              success: false,
              error: response?.error || "Analyze conflict failed",
            });
          }
        },
      );
    });
  }

  /**
   * Get available conflict resolution strategies
   *
   * @returns {Promise<TransportResponse>}
   */
  async getConflictStrategies(): Promise<TransportResponse> {
    if (!this.socket) {
      return { success: false, error: "Not connected" };
    }

    const startTime = Date.now();

    return new Promise((resolve) => {
      this.socket!.emit(
        "conflict:getStrategies",
        {
          userId: this.config.userId,
          instanceId: this.config.instanceId,
        },
        (response: any) => {
          const success = response?.type !== "error" && !response?.error;
          this.trackRequest(startTime, success);

          if (success) {
            this.logger.debug("Retrieved conflict resolution strategies via WebSocket");
            resolve({ success: true, data: response });
          } else {
            resolve({
              success: false,
              error: response?.error || "Get conflict strategies failed",
            });
          }
        },
      );
    });
  }

  /**
   * Subscribe to real-time updates for specific keys
   *
   * @param {string[]} keys - Keys to subscribe to
   * @returns {Promise<void>}
   */
  async subscribe(keys: string[]): Promise<void> {
    if (!this.socket) {
      throw new Error("Not connected");
    }

    return new Promise((resolve, reject) => {
      this.socket!.emit(
        "sync:subscribe",
        {
          keys,
          userId: this.config.userId,
          instanceId: this.config.instanceId,
        },
        (response: any) => {
          if (response?.type === "error" || response?.error) {
            reject(new Error(response?.error || "Subscription failed"));
          } else {
            this.logger.debug(`Subscribed to ${keys.length} keys via WebSocket`);
            resolve();
          }
        },
      );
    });
  }

  /**
   * Unsubscribe from real-time updates
   *
   * @param {string[]} keys - Keys to unsubscribe from
   * @returns {Promise<void>}
   */
  async unsubscribe(keys: string[]): Promise<void> {
    if (!this.socket) {
      throw new Error("Not connected");
    }

    return new Promise((resolve, reject) => {
      this.socket!.emit(
        "sync:unsubscribe",
        {
          keys,
          userId: this.config.userId,
        },
        (response: any) => {
          if (response?.type === "error" || response?.error) {
            reject(new Error(response?.error || "Unsubscription failed"));
          } else {
            this.logger.debug(`Unsubscribed from ${keys.length} keys via WebSocket`);
            resolve();
          }
        },
      );
    });
  }

  /**
   * Wait for connection with timeout
   *
   * @param {number} [timeout] - Timeout in milliseconds
   * @returns {Promise<void>}
   */
  async waitForConnection(timeout?: number): Promise<void> {
    if (this.isConnected()) return;

    return withTimeout(
      new Promise<void>((resolve, reject) => {
        const onConnect = () => {
          this.off("connect", onConnect);
          this.off("error", onError);
          resolve();
        };

        const onError = (error: any) => {
          this.off("connect", onConnect);
          this.off("error", onError);
          reject(error.error || new Error(error.message));
        };

        this.on("connect", onConnect);
        this.on("error", onError);
      }),
      timeout || this.config.timeout || 5000,
    );
  }

  /**
   * Get transport type
   *
   * @returns {TransportMode}
   */
  getType(): TransportMode {
    return TransportMode.WEBSOCKET;
  }

  /**
   * Destroy transport and cleanup
   */
  destroy(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    super.destroy();
  }
}
