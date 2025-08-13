import { EventEmitter } from "./event-emitter";
import { Logger } from "../utils/logger";

/**
 * Performance metrics interface
 *
 * @interface PerformanceMetrics
 */
export interface PerformanceMetrics {
  operationName: string;
  startTime: number;
  endTime: number;
  duration: number;
  success: boolean;
  metadata?: Record<string, any>;
}

/**
 * Aggregated performance statistics
 *
 * @interface PerformanceStats
 */
export interface PerformanceStats {
  operation: string;
  count: number;
  totalDuration: number;
  averageDuration: number;
  minDuration: number;
  maxDuration: number;
  successRate: number;
  p50: number;
  p95: number;
  p99: number;
}

/**
 * Performance monitoring configuration
 *
 * @interface PerformanceConfig
 */
export interface PerformanceConfig {
  enabled: boolean;
  sampleRate: number; // 0-1, percentage of operations to track
  maxMetricsCount: number;
  persistToSessionStorage: boolean;
  sessionStorageKey: string;
  thresholds: Record<string, number>; // Operation-specific thresholds in ms
}

/**
 * Performance monitoring and metrics collection system
 *
 * This class provides comprehensive performance tracking capabilities
 * with configurable sampling, persistence, and threshold alerts.
 *
 * @class PerformanceMonitor
 * @extends {EventEmitter}
 */
export class PerformanceMonitor extends EventEmitter<{
  "threshold-exceeded": { operation: string; duration: number; threshold: number };
  "metrics-updated": { stats: PerformanceStats };
}> {
  private logger: Logger;
  private config: PerformanceConfig;
  private readonly metrics: Map<string, PerformanceMetrics[]>;
  private activeOperations: Map<string, number>;
  private sessionMetrics: PerformanceMetrics[] = [];

  /**
   * Creates a new performance monitor instance
   *
   * @param {Partial<PerformanceConfig>} [config] - Configuration options
   */
  constructor(config?: Partial<PerformanceConfig>) {
    super();

    this.logger = new Logger("PerformanceMonitor");

    // Default configuration
    this.config = {
      enabled: true,
      sampleRate: 1.0, // Track 100% by default
      maxMetricsCount: 1000,
      persistToSessionStorage: true,
      sessionStorageKey: "sync-client:performance",
      thresholds: {
        "sync:set": 1000,
        "sync:get": 500,
        "sync:remove": 500,
        "sync:getAll": 2000,
        connect: 5000,
        batch: 3000,
      },
      ...config,
    };

    this.metrics = new Map();
    this.activeOperations = new Map();

    // Load persisted metrics if enabled
    if (this.config.persistToSessionStorage) {
      this.loadMetricsFromStorage();
    }

    this.logger.debug("Performance monitor initialized", { config: this.config });
  }

  /**
   * Start tracking an operation
   *
   * @param {string} operation - Operation name
   * @param {Record<string, any>} [metadata] - Additional metadata
   * @returns {() => void} Function to stop tracking
   */
  startOperation(operation: string, metadata?: Record<string, any>): () => void {
    if (!this.shouldTrack()) {
      return () => {}; // No-op if not tracking
    }

    const operationId = `${operation}_${Date.now()}_${Math.random()}`;
    const startTime = performance.now();

    this.activeOperations.set(operationId, startTime);

    return () => {
      this.endOperation(operationId, operation, true, metadata);
    };
  }

  /**
   * Track a completed operation
   *
   * @param {string} operation - Operation name
   * @param {number} duration - Duration in milliseconds
   * @param {boolean} [success] - Whether operation succeeded
   * @param {Record<string, any>} [metadata] - Additional metadata
   */
  trackOperation(
    operation: string,
    duration: number,
    success = true,
    metadata?: Record<string, any>,
  ): void {
    if (!this.shouldTrack()) {
      return;
    }

    const metric: PerformanceMetrics = {
      operationName: operation,
      startTime: performance.now() - duration,
      endTime: performance.now(),
      duration,
      success,
      metadata,
    };

    this.addMetric(operation, metric);
    this.checkThreshold(operation, duration);

    this.logger.trace(`Operation tracked: ${operation}`, {
      duration: duration.toFixed(2),
      success,
    });
  }

  /**
   * Get statistics for an operation
   *
   * @param {string} operation - Operation name
   * @returns {PerformanceStats | null} Statistics or null if no data
   */
  getStats(operation: string): PerformanceStats | null {
    const operationMetrics = this.metrics.get(operation);

    if (!operationMetrics || operationMetrics.length === 0) {
      return null;
    }

    const durations = operationMetrics.map((m) => m.duration).sort((a, b) => a - b);
    const successCount = operationMetrics.filter((m) => m.success).length;

    return {
      operation,
      count: operationMetrics.length,
      totalDuration: durations.reduce((a, b) => a + b, 0),
      averageDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      successRate: (successCount / operationMetrics.length) * 100,
      p50: this.percentile(durations, 0.5),
      p95: this.percentile(durations, 0.95),
      p99: this.percentile(durations, 0.99),
    };
  }

  /**
   * Get all statistics
   *
   * @returns {Map<string, PerformanceStats>} All operation statistics
   */
  getAllStats(): Map<string, PerformanceStats> {
    const allStats = new Map<string, PerformanceStats>();

    this.metrics.forEach((_, operation) => {
      const stats = this.getStats(operation);
      if (stats) {
        allStats.set(operation, stats);
      }
    });

    return allStats;
  }

  /**
   * Get session metrics
   *
   * @returns {PerformanceMetrics[]} All metrics from current session
   */
  getSessionMetrics(): PerformanceMetrics[] {
    return [...this.sessionMetrics];
  }

  /**
   * Export metrics for analysis
   *
   * @returns {Object} Exported metrics data
   */
  exportMetrics(): {
    timestamp: number;
    sessionDuration: number;
    stats: Record<string, PerformanceStats>;
    rawMetrics: Record<string, PerformanceMetrics[]>;
  } {
    const stats: Record<string, PerformanceStats> = {};
    const rawMetrics: Record<string, PerformanceMetrics[]> = {};

    this.getAllStats().forEach((stat, operation) => {
      stats[operation] = stat;
    });

    this.metrics.forEach((metrics, operation) => {
      rawMetrics[operation] = metrics;
    });

    const sessionStart = this.sessionMetrics[0]?.startTime || performance.now();

    return {
      timestamp: Date.now(),
      sessionDuration: performance.now() - sessionStart,
      stats,
      rawMetrics,
    };
  }

  /**
   * Clear all metrics
   */
  clearMetrics(): void {
    this.metrics.clear();
    this.sessionMetrics = [];
    this.activeOperations.clear();

    if (this.config.persistToSessionStorage) {
      this.clearStoredMetrics();
    }

    this.logger.debug("Metrics cleared");
  }

  /**
   * Update configuration
   *
   * @param {Partial<PerformanceConfig>} config - New configuration
   */
  updateConfig(config: Partial<PerformanceConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.debug("Configuration updated", { config: this.config });
  }

  /**
   * Set threshold for an operation
   *
   * @param {string} operation - Operation name
   * @param {number} threshold - Threshold in milliseconds
   */
  setThreshold(operation: string, threshold: number): void {
    this.config.thresholds[operation] = threshold;
  }

  /**
   * Enable or disable monitoring
   *
   * @param {boolean} enabled - Whether to enable monitoring
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    this.logger.info(`Performance monitoring ${enabled ? "enabled" : "disabled"}`);
  }

  /**
   * End an active operation
   *
   * @private
   * @param {string} operationId - Operation identifier
   * @param {string} operation - Operation name
   * @param {boolean} success - Whether operation succeeded
   * @param {Record<string, any>} [metadata] - Additional metadata
   */
  private endOperation(
    operationId: string,
    operation: string,
    success: boolean,
    metadata?: Record<string, any>,
  ): void {
    const startTime = this.activeOperations.get(operationId);

    if (startTime === undefined) {
      return;
    }

    const endTime = performance.now();
    const duration = endTime - startTime;

    this.activeOperations.delete(operationId);

    const metric: PerformanceMetrics = {
      operationName: operation,
      startTime,
      endTime,
      duration,
      success,
      metadata,
    };

    this.addMetric(operation, metric);
    this.checkThreshold(operation, duration);
  }

  /**
   * Add a metric to storage
   *
   * @private
   * @param {string} operation - Operation name
   * @param {PerformanceMetrics} metric - Metric to add
   */
  private addMetric(operation: string, metric: PerformanceMetrics): void {
    // Add to operation-specific metrics
    const operationMetrics = this.metrics.get(operation) || [];
    operationMetrics.push(metric);

    // Trim if exceeding max count
    if (operationMetrics.length > this.config.maxMetricsCount) {
      operationMetrics.shift();
    }

    this.metrics.set(operation, operationMetrics);

    // Add to session metrics
    this.sessionMetrics.push(metric);
    if (this.sessionMetrics.length > this.config.maxMetricsCount * 2) {
      this.sessionMetrics.shift();
    }

    // Persist if enabled
    if (this.config.persistToSessionStorage) {
      this.saveMetricsToStorage();
    }

    // Emit update event
    const stats = this.getStats(operation);
    if (stats) {
      this.emit("metrics-updated", { stats });
    }
  }

  /**
   * Check if operation exceeded threshold
   *
   * @private
   * @param {string} operation - Operation name
   * @param {number} duration - Duration in milliseconds
   */
  private checkThreshold(operation: string, duration: number): void {
    const threshold = this.config.thresholds[operation];

    if (threshold && duration > threshold) {
      this.logger.warn(`Performance threshold exceeded: ${operation}`, {
        duration: duration.toFixed(2),
        threshold,
      });

      this.emit("threshold-exceeded", {
        operation,
        duration,
        threshold,
      });
    }
  }

  /**
   * Determine if operation should be tracked based on sample rate
   *
   * @private
   * @returns {boolean} Whether to track
   */
  private shouldTrack(): boolean {
    if (!this.config.enabled) {
      return false;
    }

    if (this.config.sampleRate >= 1) {
      return true;
    }

    return Math.random() < this.config.sampleRate;
  }

  /**
   * Calculate percentile value
   *
   * @private
   * @param {number[]} values - Sorted array of values
   * @param {number} percentile - Percentile (0-1)
   * @returns {number} Percentile value
   */
  private percentile(values: number[], percentile: number): number {
    if (values.length === 0) {
      return 0;
    }

    const index = Math.ceil(values.length * percentile) - 1;
    return values[Math.max(0, index)];
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
      const stored = window.sessionStorage.getItem(this.config.sessionStorageKey);

      if (stored) {
        const data = JSON.parse(stored);

        // Restore metrics
        if (data.metrics) {
          Object.entries(data.metrics).forEach(([operation, metrics]) => {
            this.metrics.set(operation, metrics as PerformanceMetrics[]);
          });
        }

        // Restore session metrics
        if (data.sessionMetrics) {
          this.sessionMetrics = data.sessionMetrics;
        }

        this.logger.debug("Metrics loaded from storage");
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
      const data = {
        timestamp: Date.now(),
        metrics: Object.fromEntries(this.metrics),
        sessionMetrics: this.sessionMetrics.slice(-100), // Keep last 100 session metrics
      };

      window.sessionStorage.setItem(this.config.sessionStorageKey, JSON.stringify(data));
    } catch (error) {
      // Ignore storage errors (quota exceeded, etc.)
      this.logger.trace("Failed to save metrics to storage", { error });
    }
  }

  /**
   * Clear stored metrics
   *
   * @private
   */
  private clearStoredMetrics(): void {
    if (typeof window === "undefined" || !window.sessionStorage) {
      return;
    }

    try {
      window.sessionStorage.removeItem(this.config.sessionStorageKey);
    } catch {
      // Ignore errors
    }
  }

  /**
   * Destroy the performance monitor
   */
  destroy(): void {
    this.clearMetrics();
    this.removeAllListeners();
    this.logger.debug("Performance monitor destroyed");
  }
}

/**
 * Global performance monitor instance
 */
export const globalPerformanceMonitor = new PerformanceMonitor();

/**
 * Decorator for automatic performance tracking
 *
 * @param {string} [operationName] - Custom operation name
 * @returns {MethodDecorator} Method decorator
 *
 * @example
 * ```typescript
 * class MyClass {
 *   @trackPerformance("myOperation")
 *   async doSomething() {
 *     // Method implementation
 *   }
 * }
 * ```
 */
export function trackPerformance(operationName?: string): MethodDecorator {
  return function (_target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const operation = operationName || String(propertyKey);

    descriptor.value = async function (...args: any[]) {
      const stop = globalPerformanceMonitor.startOperation(operation);

      try {
        const result = await originalMethod.apply(this, args);
        stop();
        return result;
      } catch (error) {
        stop();
        throw error;
      }
    };

    return descriptor;
  };
}
