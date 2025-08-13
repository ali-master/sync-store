import { EventEmitter } from "../core/event-emitter";
import { Logger } from "../utils/logger";
import type { ITransport, TransportConfig, TransportEvents, TransportMetrics } from "./types";
import { TransportState, TransportMode } from "./types";

/**
 * Base transport class with common functionality for all transport implementations
 *
 * This abstract class provides shared functionality for transport implementations
 * including event handling, state management, and performance metrics tracking.
 *
 * @abstract
 * @class BaseTransport
 * @extends {EventEmitter<TransportEvents>}
 * @implements {ITransport}
 */
export abstract class BaseTransport extends EventEmitter<TransportEvents> implements ITransport {
  /**
   * Logger instance for this transport
   * @protected
   */
  protected logger: Logger;

  /**
   * Current transport state
   * @protected
   */
  protected state: TransportState = TransportState.DISCONNECTED;

  /**
   * Transport configuration
   * @protected
   */
  protected config: TransportConfig;

  /**
   * Performance metrics for this transport
   * @protected
   */
  protected metrics: TransportMetrics = {
    requestCount: 0,
    successCount: 0,
    errorCount: 0,
    averageLatency: 0,
    bytesTransferred: 0,
  };

  /**
   * Connection start time for uptime tracking
   * @protected
   */
  protected connectionStartTime?: number;

  /**
   * Session storage key for metrics persistence
   * @protected
   */
  protected readonly metricsStorageKey: string;

  /**
   * Creates a new base transport instance
   *
   * @param {TransportConfig} config - Transport configuration
   * @param {string} transportName - Name of the transport for logging
   */
  constructor(config: TransportConfig, transportName: string) {
    super();
    this.config = config;
    this.logger = new Logger(`Transport:${transportName}`);
    this.metricsStorageKey = `sync-client:metrics:${transportName}:${config.userId}`;

    // Load persisted metrics from session storage if available
    this.loadMetricsFromStorage();
  }

  /**
   * Get current transport state
   *
   * @returns {TransportState} Current state
   */
  getState(): TransportState {
    return this.state;
  }

  /**
   * Check if transport is connected
   *
   * @returns {boolean} True if connected
   */
  isConnected(): boolean {
    return this.state === TransportState.CONNECTED;
  }

  /**
   * Update transport state and emit event
   *
   * @protected
   * @param {TransportState} newState - New state
   */
  protected setState(newState: TransportState): void {
    if (this.state !== newState) {
      const oldState = this.state;
      this.state = newState;

      this.logger.debug(`State changed: ${oldState} -> ${newState}`);
      this.emit("state-change", newState);

      // Track connection uptime
      if (newState === TransportState.CONNECTED) {
        this.connectionStartTime = Date.now();
      } else if (oldState === TransportState.CONNECTED && this.connectionStartTime) {
        this.metrics.connectionUptime =
          (this.metrics.connectionUptime || 0) + (Date.now() - this.connectionStartTime);
        this.connectionStartTime = undefined;
      }
    }
  }

  /**
   * Track a request for metrics
   *
   * @protected
   * @param {number} startTime - Request start time
   * @param {boolean} success - Whether request succeeded
   * @param {number} [bytesTransferred] - Number of bytes transferred
   */
  protected trackRequest(startTime: number, success: boolean, bytesTransferred?: number): void {
    const latency = Date.now() - startTime;

    this.metrics.requestCount++;
    if (success) {
      this.metrics.successCount++;
    } else {
      this.metrics.errorCount++;
    }

    // Update average latency with exponential moving average
    const alpha = 0.3; // Smoothing factor
    this.metrics.averageLatency = this.metrics.averageLatency * (1 - alpha) + latency * alpha;

    if (bytesTransferred) {
      this.metrics.bytesTransferred = (this.metrics.bytesTransferred || 0) + bytesTransferred;
    }

    this.metrics.lastRequestTime = Date.now();

    // Persist metrics to session storage
    this.saveMetricsToStorage();
  }

  /**
   * Get current performance metrics
   *
   * @returns {TransportMetrics} Current metrics
   */
  getMetrics(): TransportMetrics {
    const currentUptime = this.connectionStartTime
      ? (this.metrics.connectionUptime || 0) + (Date.now() - this.connectionStartTime)
      : this.metrics.connectionUptime;

    return {
      ...this.metrics,
      connectionUptime: currentUptime,
    };
  }

  /**
   * Reset performance metrics
   *
   * @protected
   */
  protected resetMetrics(): void {
    this.metrics = {
      requestCount: 0,
      successCount: 0,
      errorCount: 0,
      averageLatency: 0,
      bytesTransferred: 0,
    };
    this.saveMetricsToStorage();
  }

  /**
   * Load metrics from session storage
   *
   * @private
   */
  private loadMetricsFromStorage(): void {
    if (typeof window === "undefined" || !window.sessionStorage) {
      return;
    }

    try {
      const stored = window.sessionStorage.getItem(this.metricsStorageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.metrics = {
          ...this.metrics,
          ...parsed,
          // Reset connection-specific metrics
          connectionUptime: 0,
          lastRequestTime: undefined,
        };
      }
    } catch (error) {
      this.logger.warn("Failed to load metrics from storage", { error });
    }
  }

  /**
   * Save metrics to session storage
   *
   * @private
   */
  private saveMetricsToStorage(): void {
    if (typeof window === "undefined" || !window.sessionStorage) {
      return;
    }

    try {
      window.sessionStorage.setItem(this.metricsStorageKey, JSON.stringify(this.metrics));
    } catch (error) {
      // Ignore storage errors (quota exceeded, etc.)
      this.logger.debug("Failed to save metrics to storage", { error });
    }
  }

  /**
   * Handle connection errors
   *
   * @protected
   * @param {Error} error - The error that occurred
   * @param {string} [context] - Additional context
   */
  protected handleError(error: Error, context?: string): void {
    const errorMessage = context ? `${context}: ${error.message}` : error.message;

    this.logger.error(errorMessage, { error });

    this.emit("error", {
      type: "transport",
      message: errorMessage,
      error,
    });

    if (this.state === TransportState.CONNECTING) {
      this.setState(TransportState.ERROR);
    }
  }

  /**
   * Cleanup resources
   *
   * @virtual
   */
  destroy(): void {
    this.setState(TransportState.DISCONNECTED);
    this.removeAllListeners();
    this.logger.info("Transport destroyed");
  }

  // Abstract methods to be implemented by subclasses
  abstract connect(): Promise<void>;
  abstract disconnect(): void;
  abstract setItem(
    key: string,
    value: any,
    metadata?: Record<string, any>,
    version?: number,
    timestamp?: number,
  ): Promise<any>;
  abstract getItem(key: string): Promise<any>;
  abstract removeItem(key: string): Promise<any>;
  abstract getAllItems(filter?: any): Promise<any>;
  abstract executeBatch(operations: any[]): Promise<any>;
  abstract getKeys(prefix?: string): Promise<any>;
  abstract clear(): Promise<any>;
  abstract getStorageInfo(): Promise<any>;
  abstract getConflictHistory(itemId: string): Promise<any>;
  abstract getConflictStats(startDate?: Date, endDate?: Date): Promise<any>;
  abstract resolveConflict(conflictId: string, resolveDto: any): Promise<any>;
  abstract analyzeConflict(data: any): Promise<any>;
  abstract getConflictStrategies(): Promise<any>;
  abstract subscribe(keys: string[]): Promise<void>;
  abstract unsubscribe(keys: string[]): Promise<void>;
  abstract getType(): TransportMode;
}
