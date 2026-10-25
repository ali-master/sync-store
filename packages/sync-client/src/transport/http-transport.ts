import { BaseTransport } from "./base-transport";

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
/** HTTP storage operations with bounded requests and per-key subscription polling. */
export class HttpTransport extends BaseTransport {
  private apiBaseUrl: string;

  private defaultHeaders: Record<string, string>;

  private pollingInterval?: NodeJS.Timeout;

  private subscribedKeys = new Set<string>();

  private snapshots = new Map<string, string>();
  private polling = false;

  constructor(config: TransportConfig) {
    super(config, "HTTP");

    // Construct API base URL
    const url = new URL(config.serverUrl);
    this.apiBaseUrl = `${url.origin}${url.pathname.replace(/\/$/, "") || "/api/v1"}`;

    // Setup default headers based on server API requirements
    this.defaultHeaders = {
      "x-api-key": config.apiKey || "",
      "x-user-id": config.userId,
      "x-instance-id": config.instanceId,
    };

    this.logger.info("HTTP transport initialized", {
      apiBaseUrl: this.apiBaseUrl,
      userId: config.userId,
    });
  }

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

  disconnect(): void {
    this.stopPolling();
    this.setState(TransportState.DISCONNECTED);
    this.emit("disconnect", { reason: "Client disconnect" });
    this.logger.info("Disconnected from server");
  }

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

  async getAllItems(filter?: SyncFilter): Promise<TransportResponse<StorageItem[]>> {
    const startTime = Date.now();

    try {
      const response = await this.makeRequest<StorageItem[]>("GET", "/items");
      if (response.success && filter)
        response.data = response.data?.filter(
          (item) =>
            (!filter.includePatterns?.length ||
              filter.includePatterns.some((pattern) => new RegExp(pattern).test(item.key))) &&
            !filter.excludePatterns?.some((pattern) => new RegExp(pattern).test(item.key)),
        );

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
          success: results.every((result) => result.success),
          operations: results.map((r, index) => ({
            operation: operations[index],
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

  async getStorageInfo(): Promise<TransportResponse<StorageInfo>> {
    return { success: false, error: "Server storage information is not supported" };
  }

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

  async subscribe(keys: string[]): Promise<void> {
    keys.forEach((key) => this.subscribedKeys.add(key));

    if (this.isConnected() && !this.pollingInterval) {
      this.startPolling();
    }

    this.logger.debug(`Subscribed to ${keys.length} keys (polling mode)`);
  }

  async unsubscribe(keys: string[]): Promise<void> {
    keys.forEach((key) => this.subscribedKeys.delete(key));

    if (this.subscribedKeys.size === 0) {
      this.stopPolling();
    }

    this.logger.debug(`Unsubscribed from ${keys.length} keys`);
  }

  getType(): TransportMode {
    return TransportMode.HTTP;
  }

  private async makeRequest<T = any>(
    method: string,
    path: string,
    body?: any,
  ): Promise<TransportResponse<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeout ?? 5000);
    try {
      const response = await fetch(this.apiBaseUrl + path, {
        method,
        headers:
          body === undefined
            ? this.defaultHeaders
            : { ...this.defaultHeaders, "content-type": "application/json" },
        signal: controller.signal,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : undefined;
      if (response.status === 404 && method === "GET" && path.startsWith("/item/")) {
        return { success: true, data: null as T };
      }
      return response.ok
        ? {
            success: true,
            data:
              data && typeof data === "object" && "payload" in data && "requestId" in data
                ? data.payload
                : data,
            metadata: { status: response.status },
          }
        : {
            success: false,
            error: data?.message ?? `HTTP ${response.status}`,
            metadata: { status: response.status },
          };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timer);
    }
  }

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

  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = undefined;
      this.logger.debug("Stopped polling");
    }
  }

  private async pollForUpdates(): Promise<void> {
    if (this.polling || !this.isConnected() || !this.subscribedKeys.size) return;
    this.polling = true;
    try {
      const response = await this.getAllItems();
      if (!response.success || !this.isConnected()) return;
      const items = new Map((response.data ?? []).map((item) => [item.key, item]));
      const keys = this.subscribedKeys.has("*")
        ? new Set([...items.keys(), ...this.snapshots.keys()])
        : this.subscribedKeys;
      for (const key of keys) {
        const item = items.get(key);
        const signature = JSON.stringify(item ?? null);
        if (this.snapshots.get(key) === signature) continue;
        this.snapshots.set(key, signature);
        const event: SyncEvent = {
          type: item ? "sync" : "remove",
          key,
          value: item?.value,
          metadata: item?.metadata,
          version: item?.version,
          timestamp: item?.timestamp ?? Date.now(),
          source: "remote",
        };
        void this.emit(item ? "sync:update" : "sync:remove", event);
      }
    } finally {
      this.polling = false;
    }
  }

  destroy(): void {
    this.stopPolling();
    super.destroy();
  }
}
