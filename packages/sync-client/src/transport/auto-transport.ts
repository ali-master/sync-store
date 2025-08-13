import { BaseTransport } from "./base-transport";
import { HttpTransport } from "./http-transport";
import { WebSocketTransport } from "./websocket-transport";
import { Logger } from "../utils/logger";
import type {
  ITransport,
  TransportConfig,
  TransportResponse,
  StorageInfo,
  TransportEvents,
} from "./types";
import { TransportState, TransportMode } from "./types";
import type { StorageItem, SyncFilter, BatchOperation, BatchResult } from "../types";

/**
 * Auto transport implementation with intelligent fallback
 *
 * This transport automatically selects between WebSocket and HTTP based on
 * availability and performance. It prefers WebSocket for real-time capabilities
 * but can seamlessly fallback to HTTP if WebSocket fails or is unavailable.
 *
 * @class AutoTransport
 * @extends {BaseTransport}
 */
export class AutoTransport extends BaseTransport {
  /**
   * Primary transport (WebSocket preferred)
   * @private
   */
  private primaryTransport: ITransport | null = null;

  /**
   * Fallback transport (HTTP)
   * @private
   */
  private fallbackTransport: ITransport | null = null;

  /**
   * Currently active transport
   * @private
   */
  private activeTransport: ITransport | null = null;

  /**
   * Logger for auto transport
   * @private
   */
  private autoLogger: Logger;

  /**
   * Fallback attempt counter
   * @private
   */
  private fallbackAttempts = 0;

  /**
   * Maximum fallback attempts before giving up
   * @private
   */
  private readonly maxFallbackAttempts = 3;

  /**
   * Time to wait before retrying primary transport
   * @private
   */
  private readonly primaryRetryDelay = 30000; // 30 seconds

  /**
   * Timer for retrying primary transport
   * @private
   */
  private primaryRetryTimer?: NodeJS.Timeout;

  /**
   * Creates a new auto transport instance
   *
   * @param {TransportConfig} config - Transport configuration
   */
  constructor(config: TransportConfig) {
    super(config, "Auto");
    this.autoLogger = new Logger("Transport:Auto");

    // Create both transports
    this.primaryTransport = new WebSocketTransport(config);
    this.fallbackTransport = new HttpTransport(config);

    this.setupTransportListeners();

    this.autoLogger.info("Auto transport initialized with WebSocket primary and HTTP fallback");
  }

  /**
   * Setup listeners for transport events
   *
   * @private
   */
  private setupTransportListeners(): void {
    // Forward events from active transport
    const eventTypes: Array<keyof TransportEvents> = [
      "sync:update",
      "sync:remove",
      "sync:conflict",
      "pending-updates",
    ];

    [this.primaryTransport, this.fallbackTransport].forEach((transport) => {
      if (!transport) return;

      // Forward sync events
      eventTypes.forEach((event) => {
        transport.on(event, (data: any) => {
          if (transport === this.activeTransport) {
            this.emit(event, data);
          }
        });
      });

      // Handle state changes
      transport.on("state-change", (state: TransportState) => {
        if (transport === this.activeTransport) {
          this.handleActiveTransportStateChange(state);
        }
      });

      // Handle errors
      transport.on("error", (error) => {
        if (transport === this.activeTransport) {
          this.handleActiveTransportError(error);
        }
      });
    });
  }

  /**
   * Connect using auto-selection strategy
   *
   * @returns {Promise<void>}
   */
  async connect(): Promise<void> {
    if (this.isConnected()) {
      this.autoLogger.debug("Already connected");
      return;
    }

    this.setState(TransportState.CONNECTING);

    // Try primary transport first (WebSocket)
    try {
      this.autoLogger.info("Attempting primary transport (WebSocket) connection");
      await this.primaryTransport!.connect();

      this.activeTransport = this.primaryTransport;
      this.fallbackAttempts = 0;

      this.setState(TransportState.CONNECTED);
      this.emit("connect", undefined);

      this.autoLogger.info("Connected via primary transport (WebSocket)");

      // Schedule periodic retry to switch back to primary if using fallback
      this.scheduleReturnToPrimary();
    } catch (primaryError) {
      this.autoLogger.warn("Primary transport failed, attempting fallback", {
        error: (primaryError as Error).message,
      });

      // Try fallback transport (HTTP)
      try {
        await this.fallbackToHttp();
      } catch (fallbackError) {
        this.setState(TransportState.ERROR);
        this.autoLogger.error("Both transports failed", {
          primaryError: (primaryError as Error).message,
          fallbackError: (fallbackError as Error).message,
        });
        throw new Error("Failed to connect with both WebSocket and HTTP transports");
      }
    }
  }

  /**
   * Fallback to HTTP transport
   *
   * @private
   * @returns {Promise<void>}
   */
  private async fallbackToHttp(): Promise<void> {
    this.fallbackAttempts++;

    if (this.fallbackAttempts > this.maxFallbackAttempts) {
      throw new Error("Maximum fallback attempts exceeded");
    }

    this.autoLogger.info("Attempting fallback to HTTP transport");

    await this.fallbackTransport!.connect();

    this.activeTransport = this.fallbackTransport;
    this.setState(TransportState.CONNECTED);
    this.emit("connect", undefined);

    this.autoLogger.info("Connected via fallback transport (HTTP)");

    // Schedule retry to primary transport
    this.scheduleReturnToPrimary();
  }

  /**
   * Schedule an attempt to return to primary transport
   *
   * @private
   */
  private scheduleReturnToPrimary(): void {
    // Only schedule if we're using fallback
    if (this.activeTransport !== this.fallbackTransport) {
      return;
    }

    // Clear existing timer
    if (this.primaryRetryTimer) {
      clearTimeout(this.primaryRetryTimer);
    }

    this.primaryRetryTimer = setTimeout(() => {
      this.attemptReturnToPrimary();
    }, this.primaryRetryDelay);

    this.autoLogger.debug(`Scheduled primary transport retry in ${this.primaryRetryDelay}ms`);
  }

  /**
   * Attempt to return to primary transport
   *
   * @private
   */
  private async attemptReturnToPrimary(): Promise<void> {
    if (this.activeTransport === this.primaryTransport) {
      return; // Already using primary
    }

    this.autoLogger.info("Attempting to return to primary transport");

    try {
      await this.primaryTransport!.connect();

      // Successfully connected to primary, switch over
      const oldTransport = this.activeTransport;
      this.activeTransport = this.primaryTransport;

      // Disconnect from fallback
      if (oldTransport) {
        oldTransport.disconnect();
      }

      this.fallbackAttempts = 0;
      this.autoLogger.info("Successfully returned to primary transport");

      // Clear retry timer
      if (this.primaryRetryTimer) {
        clearTimeout(this.primaryRetryTimer);
        this.primaryRetryTimer = undefined;
      }
    } catch (error) {
      this.autoLogger.debug("Failed to return to primary transport", {
        error: (error as Error).message,
      });

      // Schedule another retry
      this.scheduleReturnToPrimary();
    }
  }

  /**
   * Handle state changes in active transport
   *
   * @private
   * @param {TransportState} state - New state
   */
  private handleActiveTransportStateChange(state: TransportState): void {
    // If primary transport disconnects, try fallback
    if (state === TransportState.DISCONNECTED && this.activeTransport === this.primaryTransport) {
      this.autoLogger.warn("Primary transport disconnected, switching to fallback");
      this.fallbackToHttp().catch((error) => {
        this.autoLogger.error("Failed to fallback after primary disconnect", { error });
        this.setState(TransportState.ERROR);
      });
    } else {
      // Forward state change
      this.setState(state);
    }
  }

  /**
   * Handle errors in active transport
   *
   * @private
   * @param {any} error - Error from transport
   */
  private handleActiveTransportError(error: any): void {
    this.emit("error", error);

    // If primary transport has critical error, try fallback
    if (this.activeTransport === this.primaryTransport && error.type === "transport") {
      this.autoLogger.warn("Primary transport error, attempting fallback", { error });
      this.fallbackToHttp().catch((fallbackError) => {
        this.autoLogger.error("Failed to fallback after primary error", {
          fallbackError,
        });
      });
    }
  }

  /**
   * Disconnect from server
   */
  disconnect(): void {
    if (this.primaryRetryTimer) {
      clearTimeout(this.primaryRetryTimer);
      this.primaryRetryTimer = undefined;
    }

    if (this.activeTransport) {
      this.activeTransport.disconnect();
    }

    this.setState(TransportState.DISCONNECTED);
    this.autoLogger.info("Disconnected");
  }

  /**
   * Get current state
   *
   * @returns {TransportState}
   */
  getState(): TransportState {
    return this.activeTransport?.getState() || TransportState.DISCONNECTED;
  }

  /**
   * Check if connected
   *
   * @returns {boolean}
   */
  isConnected(): boolean {
    return this.activeTransport?.isConnected() || false;
  }

  /**
   * Get active transport type
   *
   * @returns {TransportMode}
   */
  getType(): TransportMode {
    if (!this.activeTransport) {
      return TransportMode.AUTO;
    }

    return this.activeTransport === this.primaryTransport
      ? TransportMode.WEBSOCKET
      : TransportMode.HTTP;
  }

  /**
   * Get information about transport status
   *
   * @returns {Object} Transport status information
   */
  getStatusInfo(): {
    mode: TransportMode;
    activeTransport: "websocket" | "http" | "none";
    primaryAvailable: boolean;
    fallbackAttempts: number;
    metrics: any;
  } {
    return {
      mode: TransportMode.AUTO,
      activeTransport:
        this.activeTransport === this.primaryTransport
          ? "websocket"
          : this.activeTransport === this.fallbackTransport
            ? "http"
            : "none",
      primaryAvailable: this.primaryTransport?.isConnected() || false,
      fallbackAttempts: this.fallbackAttempts,
      metrics: this.getMetrics(),
    };
  }

  // Delegate all operations to active transport

  async setItem(
    key: string,
    value: any,
    metadata?: Record<string, any>,
    version?: number,
    timestamp?: number,
  ): Promise<TransportResponse> {
    if (!this.activeTransport) {
      return { success: false, error: "No active transport" };
    }
    return this.activeTransport.setItem(key, value, metadata, version, timestamp);
  }

  async getItem(key: string): Promise<TransportResponse<StorageItem | null>> {
    if (!this.activeTransport) {
      return { success: false, error: "No active transport" };
    }
    return this.activeTransport.getItem(key);
  }

  async removeItem(key: string): Promise<TransportResponse> {
    if (!this.activeTransport) {
      return { success: false, error: "No active transport" };
    }
    return this.activeTransport.removeItem(key);
  }

  async getAllItems(filter?: SyncFilter): Promise<TransportResponse<StorageItem[]>> {
    if (!this.activeTransport) {
      return { success: false, error: "No active transport" };
    }
    return this.activeTransport.getAllItems(filter);
  }

  async executeBatch(operations: BatchOperation[]): Promise<TransportResponse<BatchResult>> {
    if (!this.activeTransport) {
      return { success: false, error: "No active transport" };
    }
    return this.activeTransport.executeBatch(operations);
  }

  async getKeys(prefix?: string): Promise<TransportResponse<string[]>> {
    if (!this.activeTransport) {
      return { success: false, error: "No active transport" };
    }
    return this.activeTransport.getKeys(prefix);
  }

  async clear(): Promise<TransportResponse> {
    if (!this.activeTransport) {
      return { success: false, error: "No active transport" };
    }
    return this.activeTransport.clear();
  }

  async getStorageInfo(): Promise<TransportResponse<StorageInfo>> {
    if (!this.activeTransport) {
      return { success: false, error: "No active transport" };
    }
    return this.activeTransport.getStorageInfo();
  }

  async getConflictHistory(itemId: string): Promise<TransportResponse> {
    if (!this.activeTransport) {
      return { success: false, error: "No active transport" };
    }
    return this.activeTransport.getConflictHistory(itemId);
  }

  async getConflictStats(startDate?: Date, endDate?: Date): Promise<TransportResponse> {
    if (!this.activeTransport) {
      return { success: false, error: "No active transport" };
    }
    return this.activeTransport.getConflictStats(startDate, endDate);
  }

  async resolveConflict(conflictId: string, resolveDto: any): Promise<TransportResponse> {
    if (!this.activeTransport) {
      return { success: false, error: "No active transport" };
    }
    return this.activeTransport.resolveConflict(conflictId, resolveDto);
  }

  async analyzeConflict(data: any): Promise<TransportResponse> {
    if (!this.activeTransport) {
      return { success: false, error: "No active transport" };
    }
    return this.activeTransport.analyzeConflict(data);
  }

  async getConflictStrategies(): Promise<TransportResponse> {
    if (!this.activeTransport) {
      return { success: false, error: "No active transport" };
    }
    return this.activeTransport.getConflictStrategies();
  }

  async subscribe(keys: string[]): Promise<void> {
    if (!this.activeTransport) {
      throw new Error("No active transport");
    }
    return this.activeTransport.subscribe(keys);
  }

  async unsubscribe(keys: string[]): Promise<void> {
    if (!this.activeTransport) {
      throw new Error("No active transport");
    }
    return this.activeTransport.unsubscribe(keys);
  }

  /**
   * Destroy transport and cleanup
   */
  destroy(): void {
    if (this.primaryRetryTimer) {
      clearTimeout(this.primaryRetryTimer);
    }

    if (this.primaryTransport) {
      this.primaryTransport.destroy();
    }

    if (this.fallbackTransport) {
      this.fallbackTransport.destroy();
    }

    super.destroy();
  }
}
