import { io, type Socket } from "socket.io-client";
import { BaseTransport } from "./base-transport";
import {
  TransportMode,
  TransportState,
  type TransportConfig,
  type TransportResponse,
  type StorageInfo,
} from "./types";
import type { StorageItem, SyncFilter, BatchOperation, BatchResult } from "../types";

/** Socket.IO storage transport with a deadline on every acknowledgement. */
export class WebSocketTransport extends BaseTransport {
  private socket: Socket | null = null;
  private connecting?: Promise<void>;
  private subscriptions = new Set<string>();

  constructor(config: TransportConfig) {
    super(config, "WebSocket");
  }

  /** Share one connection attempt and keep credentials out of query strings. */
  async connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    if (this.isConnected()) return;
    this.setState(TransportState.CONNECTING);
    this.socket?.disconnect();
    const socket = io(new URL("/sync", this.config.serverUrl).href, {
      transports: ["websocket"],
      auth: {
        userId: this.config.userId,
        instanceId: this.config.instanceId,
        apiKey: this.config.apiKey,
      },
      timeout: this.config.timeout ?? 5000,
      reconnection: this.config.reconnection !== false,
      forceNew: true,
      autoConnect: false,
    });
    this.socket = socket;
    socket.on("disconnect", (reason) => {
      this.setState(TransportState.DISCONNECTED);
      void this.emit("disconnect", { reason });
    });
    for (const event of [
      "sync:update",
      "sync:remove",
      "sync:conflict",
      "pending-updates",
    ] as const) {
      socket.on(event, (data) => {
        void this.emit(event, data);
      });
    }
    let connectedBefore = false;
    socket.on("connect", () => {
      this.setState(TransportState.CONNECTED);
      void this.emit(
        connectedBefore ? "reconnect" : "connect",
        connectedBefore ? { attempt: 0 } : (undefined as any),
      );
      connectedBefore = true;
      if (this.subscriptions.size)
        void this.subscribe([...this.subscriptions]).catch((error) => this.handleError(error));
    });
    this.connecting = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => fail(new Error("Connection timeout")),
        this.config.timeout ?? 5000,
      );
      const cleanup = () => {
        clearTimeout(timer);
        socket.off("connect", ready);
        socket.off("connect_error", fail);
      };
      const ready = () => {
        cleanup();
        resolve();
      };
      const fail = (error: Error) => {
        cleanup();
        socket.disconnect();
        this.setState(TransportState.ERROR);
        reject(error);
      };
      socket.once("connect", ready);
      socket.once("connect_error", fail);
      socket.connect();
    }).finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket?.removeAllListeners();
    this.socket = null;
    this.setState(TransportState.DISCONNECTED);
  }

  /** Resolve failures explicitly so the outbox retains unacknowledged mutations. */
  private async request<T = any>(
    event: string,
    data: Record<string, any> = {},
  ): Promise<TransportResponse<T>> {
    if (!this.socket?.connected) return { success: false, error: "Not connected" };
    const start = Date.now();
    try {
      const response = await this.socket
        .timeout(this.config.timeout ?? 5000)
        .emitWithAck(event, data);
      const success = response?.type === "response" && !response.error;
      this.trackRequest(start, success);
      return success
        ? { success: true, data: response }
        : { success: false, error: response?.error ?? "Invalid server response" };
    } catch (error) {
      this.trackRequest(start, false);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  setItem(
    key: string,
    value: any,
    metadata?: Record<string, any>,
    version?: number,
    timestamp?: number,
    requestId = crypto.randomUUID(),
  ): Promise<TransportResponse> {
    return this.request("sync:set", { key, value, metadata, version, timestamp, requestId });
  }

  async getItem(key: string): Promise<TransportResponse<StorageItem | null>> {
    const response = await this.request<StorageItem>("sync:get", { key });
    return response.success && response.data?.version === undefined
      ? { success: true, data: null }
      : response;
  }

  removeItem(key: string, requestId = crypto.randomUUID()): Promise<TransportResponse> {
    return this.request("sync:remove", { key, requestId });
  }

  async getAllItems(filter?: SyncFilter): Promise<TransportResponse<StorageItem[]>> {
    const response = await this.request<{ items: StorageItem[] }>("sync:getAll");
    if (!response.success) return { success: false, error: response.error };
    const items = response.data?.items ?? [];
    return {
      success: true,
      data: items.filter(
        (item) =>
          (!filter?.includePatterns?.length ||
            filter.includePatterns.some((pattern) => new RegExp(pattern).test(item.key))) &&
          !filter?.excludePatterns?.some((pattern) => new RegExp(pattern).test(item.key)),
      ),
    };
  }

  async getKeys(prefix?: string): Promise<TransportResponse<string[]>> {
    const response = await this.getAllItems();
    return response.success
      ? {
          success: true,
          data: response.data
            ?.map((item) => item.key)
            .filter((key) => !prefix || key.startsWith(prefix)),
        }
      : { success: false, error: response.error };
  }

  clear(requestId = crypto.randomUUID()): Promise<TransportResponse> {
    return this.request("sync:clear", { requestId });
  }

  /** Batch results retain the original operation even when multiple entries use the same key. */
  async executeBatch(operations: BatchOperation[]): Promise<TransportResponse<BatchResult>> {
    const start = Date.now();
    const results: BatchResult["operations"] = [];
    for (const operation of operations) {
      const response =
        operation.type === "set"
          ? await this.setItem(operation.key, operation.value, operation.metadata)
          : operation.type === "remove"
            ? await this.removeItem(operation.key)
            : await this.getItem(operation.key);
      results.push({
        operation,
        success: response.success,
        result: response.data,
        error: response.error,
      });
    }
    return {
      success: true,
      data: {
        success: results.every((result) => result.success),
        operations: results,
        totalTime: Date.now() - start,
      },
    };
  }

  /** Fail immediately for operations the server does not implement over WebSocket. */
  async getStorageInfo(): Promise<TransportResponse<StorageInfo>> {
    return { success: false, error: "Storage information is not supported" };
  }
  async getConflictHistory(_itemId: string): Promise<TransportResponse> {
    return this.unsupportedConflict();
  }
  async getConflictStats(_startDate?: Date, _endDate?: Date): Promise<TransportResponse> {
    return this.unsupportedConflict();
  }
  async resolveConflict(_conflictId: string, _data: any): Promise<TransportResponse> {
    return this.unsupportedConflict();
  }
  async analyzeConflict(_data: any): Promise<TransportResponse> {
    return this.unsupportedConflict();
  }
  async getConflictStrategies(): Promise<TransportResponse> {
    return this.unsupportedConflict();
  }
  private unsupportedConflict(): TransportResponse {
    return { success: false, error: "Use HTTP transport for conflict administration" };
  }

  async subscribe(keys: string[]): Promise<void> {
    keys.forEach((key) => this.subscriptions.add(key));
    if (!this.isConnected()) return;
    const response = await this.request("sync:subscribe", { keys });
    if (!response.success) throw new Error(response.error);
  }

  async unsubscribe(keys: string[]): Promise<void> {
    keys.forEach((key) => this.subscriptions.delete(key));
    if (!this.isConnected()) return;
    const response = await this.request("sync:unsubscribe", { keys });
    if (!response.success) throw new Error(response.error);
  }

  async waitForConnection(timeout = this.config.timeout ?? 5000): Promise<void> {
    if (this.isConnected()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.connect(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Connection timeout")), timeout);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  getType(): TransportMode {
    return TransportMode.WEBSOCKET;
  }
  destroy(): void {
    this.disconnect();
    super.destroy();
  }
}
