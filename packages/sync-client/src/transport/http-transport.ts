import { BaseTransport } from "./base-transport";
import { retry, withTimeout } from "../utils/retry";
import type { TransportConfig, TransportResponse, StorageInfo } from "./types";
import { TransportState, TransportMode } from "./types";
import type { StorageItem, SyncFilter, BatchOperation, BatchResult, SyncEvent } from "../types";

/**
 * HTTP REST transport implementation for sync client
 *
 * This transport uses standard HTTP REST APIs for all communication with the server.
 * It provides full CRUD operations and batch processing capabilities without
 * real-time features. When used in strict mode (mode: "http"), it will not
 * attempt WebSocket fallback even if operations fail.
 *
 * @class HttpTransport
 * @extends {BaseTransport}
 */
export class HttpTransport extends BaseTransport {
  /**
   * Base URL for API endpoints
   * @private
   */
  private apiBaseUrl: string;

  /**
   * Default headers for all requests
   * @private
   */
  private defaultHeaders: Record<string, string>;

  /**
   * Polling interval for simulated real-time updates
   * @private
   */
  private pollingInterval?: NodeJS.Timeout;

  /**
   * Subscribed keys for polling
   * @private
   */
  private subscribedKeys = new Set<string>();

  /**
   * Last sync timestamp for polling optimization
   * @private
   */
  private lastSyncTimestamp = 0;

  /**
   * Creates a new HTTP transport instance
   *
   * @param {TransportConfig} config - Transport configuration
   */
  constructor(config: TransportConfig) {
    super(config, "HTTP");

    // Construct API base URL
    const url = new URL(config.serverUrl);
    this.apiBaseUrl = `${url.protocol}//${url.host}/sync-storage`;

    // Setup default headers based on server API requirements
    this.defaultHeaders = {
      "Content-Type": "application/json",
      "api-key": config.apiKey || "",
      "user-id": config.userId,
      "instance-id": config.instanceId,
    };

    this.logger.info("HTTP transport initialized", {
      apiBaseUrl: this.apiBaseUrl,
      userId: config.userId,
    });
  }

  /**
   * Connect to the server (validates connection)
   *
   * @returns {Promise<void>}
   * @throws {Error} If connection validation fails
   */
  async connect(): Promise<void> {
    if (this.isConnected()) {
      this.logger.debug("Already connected");
      return;
    }

    this.setState(TransportState.CONNECTING);
    const startTime = Date.now();

    try {
      // Validate connection by getting storage keys (lightweight operation)
      const response = await this.makeRequest("GET", "/keys");

      if (!response.success) {
        throw new Error(response.error || "Connection validation failed");
      }

      this.setState(TransportState.CONNECTED);
      this.emit("connect", undefined);

      this.trackRequest(startTime, true);
      this.logger.info("Connected to server via HTTP");

      // Start polling if we have subscriptions
      if (this.subscribedKeys.size > 0) {
        this.startPolling();
      }
    } catch (error) {
      this.trackRequest(startTime, false);
      this.handleError(error as Error, "Connection failed");
      throw error;
    }
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    this.stopPolling();
    this.setState(TransportState.DISCONNECTED);
    this.emit("disconnect", { reason: "Client disconnect" });
    this.logger.info("Disconnected from server");
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
    _version?: number,
    _timestamp?: number,
  ): Promise<TransportResponse> {
    const startTime = Date.now();

    try {
      const response = await this.makeRequest("PUT", `/item/${encodeURIComponent(key)}`, {
        value,
        metadata,
      });

      this.trackRequest(startTime, response.success, JSON.stringify(value).length);

      if (response.success) {
        this.logger.debug(`Item set successfully: ${key}`);
      }

      return response;
    } catch (error) {
      this.trackRequest(startTime, false);
      throw error;
    }
  }

  /**
   * Get an item from the server
   *
   * @param {string} key - Storage key
   * @returns {Promise<TransportResponse<StorageItem | null>>}
   */
  async getItem(key: string): Promise<TransportResponse<StorageItem | null>> {
    const startTime = Date.now();

    try {
      const response = await this.makeRequest<StorageItem>(
        "GET",
        `/item/${encodeURIComponent(key)}`,
      );

      this.trackRequest(startTime, response.success);

      if (response.success && response.data) {
        this.logger.debug(`Item retrieved: ${key}`);
      }

      return response;
    } catch (error) {
      this.trackRequest(startTime, false);
      throw error;
    }
  }

  /**
   * Remove an item from the server
   *
   * @param {string} key - Storage key
   * @returns {Promise<TransportResponse>}
   */
  async removeItem(key: string): Promise<TransportResponse> {
    const startTime = Date.now();

    try {
      const response = await this.makeRequest("DELETE", `/item/${encodeURIComponent(key)}`);

      this.trackRequest(startTime, response.success);

      if (response.success) {
        this.logger.debug(`Item removed: ${key}`);
      }

      return response;
    } catch (error) {
      this.trackRequest(startTime, false);
      throw error;
    }
  }

  /**
   * Get all items from the server
   *
   * @param {SyncFilter} [filter] - Optional filter
   * @returns {Promise<TransportResponse<StorageItem[]>>}
   */
  async getAllItems(filter?: SyncFilter): Promise<TransportResponse<StorageItem[]>> {
    const startTime = Date.now();

    try {
      const queryParams = filter?.includePatterns?.[0]
        ? `?prefix=${encodeURIComponent(filter.includePatterns[0])}`
        : "";
      const response = await this.makeRequest<StorageItem[]>("GET", `/items${queryParams}`);

      this.trackRequest(startTime, response.success);

      if (response.success) {
        this.logger.debug(`Retrieved ${response.data?.length || 0} items`);
      }

      return response;
    } catch (error) {
      this.trackRequest(startTime, false);
      throw error;
    }
  }

  /**
   * Execute batch operations
   *
   * @param {BatchOperation[]} operations - Operations to execute
   * @returns {Promise<TransportResponse<BatchResult>>}
   */
  async executeBatch(operations: BatchOperation[]): Promise<TransportResponse<BatchResult>> {
    const startTime = Date.now();

    try {
      // Batch operations - execute sequentially since server doesn't have batch endpoint
      const results: any[] = [];

      for (const operation of operations) {
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
      }

      // const successCount = results.filter(r => r.success).length;
      const response = {
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
      };

      this.trackRequest(startTime, response.success);

      if (response.success) {
        const successCount = response.data?.operations.filter((op) => op.success).length || 0;
        this.logger.debug(`Batch executed: ${successCount}/${operations.length} succeeded`);
      }

      return response;
    } catch (error) {
      this.trackRequest(startTime, false);
      throw error;
    }
  }

  /**
   * Get all storage keys
   *
   * @param {string} [prefix] - Optional prefix filter
   * @returns {Promise<TransportResponse<string[]>>}
   */
  async getKeys(prefix?: string): Promise<TransportResponse<string[]>> {
    const startTime = Date.now();

    try {
      const queryParams = prefix ? `?prefix=${encodeURIComponent(prefix)}` : "";
      const response = await this.makeRequest<string[]>("GET", `/keys${queryParams}`);

      this.trackRequest(startTime, response.success);

      if (response.success) {
        this.logger.debug(`Retrieved ${response.data?.length || 0} keys`);
      }

      return response;
    } catch (error) {
      this.trackRequest(startTime, false);
      throw error;
    }
  }

  /**
   * Clear all storage for the user
   *
   * @returns {Promise<TransportResponse>}
   */
  async clear(): Promise<TransportResponse> {
    const startTime = Date.now();

    try {
      const response = await this.makeRequest("DELETE", "/clear");

      this.trackRequest(startTime, response.success);

      if (response.success) {
        this.logger.debug("Storage cleared successfully");
      }

      return response;
    } catch (error) {
      this.trackRequest(startTime, false);
      throw error;
    }
  }

  /**
   * Get server storage information
   *
   * @returns {Promise<TransportResponse<StorageInfo>>}
   */
  async getStorageInfo(): Promise<TransportResponse<StorageInfo>> {
    const startTime = Date.now();

    try {
      // Storage info endpoint doesn't exist in server, simulate with available data
      const keysResponse = await this.makeRequest<string[]>("GET", "/keys");

      if (!keysResponse.success) {
        return {
          success: false,
          error: keysResponse.error || "Failed to get storage info",
        };
      }

      const response = {
        success: true,
        data: {
          usagePercentage: 0, // Cannot determine from available endpoints
          totalSize: 0, // Cannot determine from available endpoints
          usedSize: 0, // Cannot determine from available endpoints
          itemCount: keysResponse.data?.length || 0,
          maxItemSize: 0, // Cannot determine from available endpoints
          quotaRemaining: 0, // Cannot determine from available endpoints
        } as StorageInfo,
      };

      this.trackRequest(startTime, response.success);

      if (response.success) {
        this.logger.debug("Storage info retrieved", response.data);
      }

      return response;
    } catch (error) {
      this.trackRequest(startTime, false);
      throw error;
    }
  }

  /**
   * Get conflict history for a storage item
   *
   * @param {string} itemId - The item ID to get conflict history for
   * @returns {Promise<TransportResponse>}
   */
  async getConflictHistory(itemId: string): Promise<TransportResponse> {
    const startTime = Date.now();

    try {
      const response = await this.makeRequest(
        "GET",
        `/conflicts/history/${encodeURIComponent(itemId)}`,
      );

      this.trackRequest(startTime, response.success);

      if (response.success) {
        this.logger.debug(`Retrieved conflict history for item: ${itemId}`);
      }

      return response;
    } catch (error) {
      this.trackRequest(startTime, false);
      throw error;
    }
  }

  /**
   * Get conflict statistics for the current user
   *
   * @param {Date} [startDate] - Start date for statistics
   * @param {Date} [endDate] - End date for statistics
   * @returns {Promise<TransportResponse>}
   */
  async getConflictStats(startDate?: Date, endDate?: Date): Promise<TransportResponse> {
    const startTime = Date.now();

    try {
      const queryParams = new URLSearchParams();
      if (startDate) queryParams.set("startDate", startDate.toISOString());
      if (endDate) queryParams.set("endDate", endDate.toISOString());

      const queryString = queryParams.toString();
      const response = await this.makeRequest(
        "GET",
        `/conflicts/stats${queryString ? `?${queryString}` : ""}`,
      );

      this.trackRequest(startTime, response.success);

      if (response.success) {
        this.logger.debug("Retrieved conflict statistics");
      }

      return response;
    } catch (error) {
      this.trackRequest(startTime, false);
      throw error;
    }
  }

  /**
   * Resolve a specific conflict
   *
   * @param {string} conflictId - The conflict ID to resolve
   * @param {any} resolveDto - The resolution strategy and options
   * @returns {Promise<TransportResponse>}
   */
  async resolveConflict(conflictId: string, resolveDto: any): Promise<TransportResponse> {
    const startTime = Date.now();

    try {
      const response = await this.makeRequest(
        "PUT",
        `/conflicts/resolve/${encodeURIComponent(conflictId)}`,
        resolveDto,
      );

      this.trackRequest(startTime, response.success);

      if (response.success) {
        this.logger.debug(`Resolved conflict: ${conflictId}`);
      }

      return response;
    } catch (error) {
      this.trackRequest(startTime, false);
      throw error;
    }
  }

  /**
   * Analyze potential conflicts for given data
   *
   * @param {any} data - The data to analyze for conflicts
   * @returns {Promise<TransportResponse>}
   */
  async analyzeConflict(data: any): Promise<TransportResponse> {
    const startTime = Date.now();

    try {
      const response = await this.makeRequest("POST", "/conflicts/analyze", data);

      this.trackRequest(startTime, response.success);

      if (response.success) {
        this.logger.debug("Analyzed conflict for data");
      }

      return response;
    } catch (error) {
      this.trackRequest(startTime, false);
      throw error;
    }
  }

  /**
   * Get available conflict resolution strategies
   *
   * @returns {Promise<TransportResponse>}
   */
  async getConflictStrategies(): Promise<TransportResponse> {
    const startTime = Date.now();

    try {
      const response = await this.makeRequest("GET", "/conflicts/strategies");

      this.trackRequest(startTime, response.success);

      if (response.success) {
        this.logger.debug("Retrieved conflict resolution strategies");
      }

      return response;
    } catch (error) {
      this.trackRequest(startTime, false);
      throw error;
    }
  }

  /**
   * Subscribe to keys (starts polling in HTTP mode)
   *
   * @param {string[]} keys - Keys to subscribe to
   * @returns {Promise<void>}
   */
  async subscribe(keys: string[]): Promise<void> {
    keys.forEach((key) => this.subscribedKeys.add(key));

    if (this.isConnected() && !this.pollingInterval) {
      this.startPolling();
    }

    this.logger.debug(`Subscribed to ${keys.length} keys (polling mode)`);
  }

  /**
   * Unsubscribe from keys
   *
   * @param {string[]} keys - Keys to unsubscribe from
   * @returns {Promise<void>}
   */
  async unsubscribe(keys: string[]): Promise<void> {
    keys.forEach((key) => this.subscribedKeys.delete(key));

    if (this.subscribedKeys.size === 0) {
      this.stopPolling();
    }

    this.logger.debug(`Unsubscribed from ${keys.length} keys`);
  }

  /**
   * Get transport type
   *
   * @returns {TransportMode}
   */
  getType(): TransportMode {
    return TransportMode.HTTP;
  }

  /**
   * Make an HTTP request with retry logic
   *
   * @private
   * @template T
   * @param {string} method - HTTP method
   * @param {string} path - API path
   * @param {any} [body] - Request body
   * @returns {Promise<TransportResponse<T>>}
   */
  private async makeRequest<T = any>(
    method: string,
    path: string,
    body?: any,
  ): Promise<TransportResponse<T>> {
    const url = `${this.apiBaseUrl}${path}`;

    const executeRequest = async (): Promise<TransportResponse<T>> => {
      const options: RequestInit = {
        method,
        headers: this.defaultHeaders,
        ...(body && { body: JSON.stringify(body) }),
      };

      try {
        const response = await withTimeout(fetch(url, options), this.config.timeout || 5000);

        const contentType = response.headers.get("content-type");
        const isJson = contentType?.includes("application/json");

        if (response.ok) {
          const data = isJson ? await response.json() : null;
          return {
            success: true,
            data: data as T,
            metadata: {
              status: response.status,
              headers: this.headersToObject(response.headers),
            },
          };
        } else {
          const error = isJson ? await response.json() : await response.text();

          return {
            success: false,
            error: typeof error === "string" ? error : error.message || "Request failed",
            metadata: {
              status: response.status,
              headers: this.headersToObject(response.headers),
            },
          };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        this.logger.error(`Request failed: ${method} ${path}`, { error: errorMessage });

        return {
          success: false,
          error: errorMessage,
        };
      }
    };

    // Apply retry logic if configured
    if (this.config.retry && this.config.retry.maxAttempts > 1) {
      return retry(executeRequest, this.config.retry);
    }

    return executeRequest();
  }

  /**
   * Start polling for updates
   *
   * @private
   */
  private startPolling(): void {
    if (this.pollingInterval) {
      return;
    }

    const pollInterval = 5000; // 5 seconds

    this.pollingInterval = setInterval(() => {
      this.pollForUpdates();
    }, pollInterval);

    this.logger.debug(`Started polling every ${pollInterval}ms`);
  }

  /**
   * Stop polling for updates
   *
   * @private
   */
  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = undefined;
      this.logger.debug("Stopped polling");
    }
  }

  /**
   * Poll for updates on subscribed keys
   *
   * @private
   */
  private async pollForUpdates(): Promise<void> {
    if (!this.isConnected() || this.subscribedKeys.size === 0) {
      return;
    }

    try {
      // Server doesn't have updates endpoint, poll individual keys for changes
      const events: SyncEvent[] = [];

      for (const key of this.subscribedKeys) {
        try {
          const itemResponse = await this.makeRequest<StorageItem>(
            "GET",
            `/item/${encodeURIComponent(key)}`,
          );

          if (
            itemResponse.success &&
            itemResponse.data &&
            (itemResponse.data.timestamp || 0) > this.lastSyncTimestamp
          ) {
            events.push({
              type: "sync",
              key,
              value: itemResponse.data.value,
              metadata: itemResponse.data.metadata,
              timestamp: itemResponse.data.timestamp || Date.now(),
              version: itemResponse.data.version || 1,
              source: "remote" as const,
              instanceId: this.config.instanceId,
            });
          }
        } catch {
          // Ignore individual key errors during polling
        }
      }

      const response = { success: true, data: events };

      if (response.success && response.data && response.data.length > 0) {
        response.data.forEach((event) => {
          if (event.type === "sync") {
            this.emit("sync:update", event);
          } else if (event.type === "remove") {
            this.emit("sync:remove", event);
          }

          this.lastSyncTimestamp = Math.max(this.lastSyncTimestamp, event.timestamp);
        });

        this.logger.debug(`Polled ${response.data.length} updates`);
      }
    } catch (error) {
      this.logger.warn("Polling failed", { error });
    }
  }

  /**
   * Convert Headers object to plain object
   *
   * @private
   * @param {Headers} headers - Headers object
   * @returns {Record<string, string>} Plain object with header key-value pairs
   */
  private headersToObject(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  /**
   * Destroy transport and cleanup
   */
  destroy(): void {
    this.stopPolling();
    super.destroy();
  }
}
