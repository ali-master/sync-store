import type { AnalyticsConfig, AnalyticsEvent, PerformanceMetrics } from "../types";
import { EventEmitter } from "./event-emitter";
import { Logger } from "../utils/logger";

/**
 * Comprehensive analytics and telemetry system
 */
export class Analytics extends EventEmitter<{
  "event-tracked": AnalyticsEvent;
  "batch-sent": { events: AnalyticsEvent[]; success: boolean };
  "performance-warning": { metric: string; value: number; threshold: number };
}> {
  private logger = new Logger("Analytics");
  private eventQueue: AnalyticsEvent[] = [];
  private performanceMetrics: PerformanceMetrics;
  private sessionId: string;
  private sessionStart: number;
  private flushInterval?: NodeJS.Timeout;
  private performanceMonitorInterval?: NodeJS.Timeout;

  constructor(
    private config: AnalyticsConfig,
    private userId: string,
    private instanceId: string,
  ) {
    super();

    this.sessionId = this.generateSessionId();
    this.sessionStart = Date.now();

    this.performanceMetrics = {
      syncLatency: [],
      memoryUsage: 0,
      operationTimes: {},
      isOnline: true,
      errorCount: {
        network: 0,
        server: 0,
        authentication: 0,
        quota: 0,
        conflict: 0,
        validation: 0,
        storage: 0,
      },
      cacheHitRate: 0,
    };

    if (config.enabled) {
      this.startFlushInterval();
      if (config.trackPerformance) {
        this.startPerformanceMonitoring();
      }
    }
  }

  /**
   * Track a custom event
   */
  track(type: string, data: Record<string, any> = {}): void {
    if (!this.config.enabled) return;

    const event: AnalyticsEvent = {
      type,
      data,
      timestamp: Date.now(),
      userId: this.userId,
      instanceId: this.instanceId,
      sessionId: this.sessionId,
    };

    this.eventQueue.push(event);
    this.emit("event-tracked", event);

    this.logger.debug(`Event tracked: ${type}`, { data });

    // Auto-flush if queue is full
    if (this.eventQueue.length >= (this.config.batchSize || 50)) {
      this.flush();
    }
  }

  /**
   * Track sync operation performance
   */
  trackSync(
    operation: string,
    duration: number,
    success: boolean,
    metadata?: Record<string, any>,
  ): void {
    if (!this.config.enabled || !this.config.trackPerformance) return;

    // Update sync latency metrics
    this.performanceMetrics.syncLatency.push(duration);
    if (this.performanceMetrics.syncLatency.length > 100) {
      this.performanceMetrics.syncLatency.shift();
    }

    // Track operation time
    if (!this.performanceMetrics.operationTimes[operation]) {
      this.performanceMetrics.operationTimes[operation] = 0;
    }
    this.performanceMetrics.operationTimes[operation] =
      (this.performanceMetrics.operationTimes[operation] + duration) / 2;

    this.track("sync_operation", {
      operation,
      duration,
      success,
      ...metadata,
    });

    // Check for performance warnings
    this.checkPerformanceThresholds(operation, duration);
  }

  /**
   * Track error occurrence
   */
  trackError(type: string, error: Error, context?: Record<string, any>): void {
    if (!this.config.enabled || !this.config.trackErrors) return;

    // Update error count metrics
    const errorType = type as keyof typeof this.performanceMetrics.errorCount;
    if (errorType in this.performanceMetrics.errorCount) {
      this.performanceMetrics.errorCount[errorType]++;
    }

    this.track("error", {
      type,
      message: error.message,
      stack: error.stack,
      context,
    });
  }

  /**
   * Track user interaction
   */
  trackInteraction(action: string, target: string, metadata?: Record<string, any>): void {
    if (!this.config.enabled) return;

    this.track("user_interaction", {
      action,
      target,
      ...metadata,
    });
  }

  /**
   * Track storage operation
   */
  trackStorageOperation(
    operation: "get" | "set" | "remove" | "clear",
    key: string,
    size?: number,
    cached?: boolean,
  ): void {
    if (!this.config.enabled || !this.config.trackUsage) return;

    // Update cache hit rate
    if (operation === "get" && cached !== undefined) {
      const currentRate = this.performanceMetrics.cacheHitRate;
      this.performanceMetrics.cacheHitRate = (currentRate + (cached ? 1 : 0)) / 2;
    }

    this.track("storage_operation", {
      operation,
      key: this.sanitizeKey(key),
      size,
      cached,
    });
  }

  /**
   * Track network state changes
   */
  trackNetworkState(isOnline: boolean): void {
    if (!this.config.enabled || !this.config.trackPerformance) return;

    this.performanceMetrics.isOnline = isOnline;

    this.track("network_state", {
      isOnline,
    });
  }

  /**
   * Track feature usage
   */
  trackFeature(feature: string, enabled: boolean, metadata?: Record<string, any>): void {
    if (!this.config.enabled) return;

    this.track("feature_usage", {
      feature,
      enabled,
      ...metadata,
    });
  }

  /**
   * Track session data
   */
  trackSession(): void {
    if (!this.config.enabled) return;

    const sessionDuration = Date.now() - this.sessionStart;

    this.track("session", {
      duration: sessionDuration,
      eventsTracked: this.eventQueue.length,
      performanceMetrics: this.getPerformanceSummary(),
    });
  }

  /**
   * Get current performance metrics
   */
  getPerformanceMetrics(): PerformanceMetrics {
    // Update memory usage if available
    if (typeof performance !== "undefined" && "memory" in performance) {
      const memory = (performance as any).memory;
      this.performanceMetrics.memoryUsage = memory.usedJSHeapSize || 0;
    }

    return { ...this.performanceMetrics };
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary(): Record<string, any> {
    const metrics = this.performanceMetrics;

    return {
      averageSyncLatency:
        metrics.syncLatency.length > 0
          ? metrics.syncLatency.reduce((a, b) => a + b, 0) / metrics.syncLatency.length
          : 0,
      memoryUsage: metrics.memoryUsage,
      totalErrors: Object.values(metrics.errorCount).reduce((a, b) => a + b, 0),
      cacheHitRate: metrics.cacheHitRate,
      isOnline: metrics.isOnline,
    };
  }

  /**
   * Flush events to analytics endpoint
   */
  async flush(): Promise<void> {
    if (!this.config.enabled || this.eventQueue.length === 0) return;

    const events = [...this.eventQueue];
    this.eventQueue = [];

    try {
      if (this.config.endpoint) {
        await this.sendToEndpoint(events);
      } else if (this.config.customEvents) {
        // Allow custom handling through events
        this.emit("batch-sent", { events, success: true });
      }

      this.logger.debug(`Flushed ${events.length} analytics events`);
    } catch (error) {
      this.logger.error("Failed to flush analytics events", { error });

      // Re-queue events on failure (with limit)
      if (this.eventQueue.length < 200) {
        this.eventQueue.unshift(...events);
      }

      this.emit("batch-sent", { events, success: false });
    }
  }

  /**
   * Send events to analytics endpoint
   */
  private async sendToEndpoint(events: AnalyticsEvent[]): Promise<void> {
    if (!this.config.endpoint) return;

    const response = await fetch(this.config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        events,
        metadata: {
          sdk: "sync-client",
          version: "1.0.0",
          sessionId: this.sessionId,
          timestamp: Date.now(),
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Analytics endpoint error: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Start automatic event flushing
   */
  private startFlushInterval(): void {
    const interval = this.config.flushInterval || 30000; // 30 seconds default

    this.flushInterval = setInterval(() => {
      this.flush();
    }, interval);
  }

  /**
   * Start performance monitoring
   */
  private startPerformanceMonitoring(): void {
    this.performanceMonitorInterval = setInterval(() => {
      this.collectPerformanceMetrics();
    }, 10000); // Every 10 seconds
  }

  /**
   * Collect current performance metrics
   */
  private collectPerformanceMetrics(): void {
    // Memory usage
    if (typeof performance !== "undefined" && "memory" in performance) {
      const memory = (performance as any).memory;
      this.performanceMetrics.memoryUsage = memory.usedJSHeapSize || 0;

      // Warn about high memory usage
      if (memory.usedJSHeapSize > 50 * 1024 * 1024) {
        // 50MB
        this.emit("performance-warning", {
          metric: "memory",
          value: memory.usedJSHeapSize,
          threshold: 50 * 1024 * 1024,
        });
      }
    }

    // Check sync latency
    const avgLatency =
      this.performanceMetrics.syncLatency.length > 0
        ? this.performanceMetrics.syncLatency.reduce((a, b) => a + b, 0) /
          this.performanceMetrics.syncLatency.length
        : 0;

    if (avgLatency > 2000) {
      // 2 seconds
      this.emit("performance-warning", {
        metric: "sync-latency",
        value: avgLatency,
        threshold: 2000,
      });
    }
  }

  /**
   * Check performance thresholds and emit warnings
   */
  private checkPerformanceThresholds(operation: string, duration: number): void {
    const thresholds: Record<string, number> = {
      "sync:set": 1000,
      "sync:get": 500,
      "sync:remove": 500,
      "sync:getAll": 2000,
    };

    const threshold = thresholds[operation];
    if (threshold && duration > threshold) {
      this.emit("performance-warning", {
        metric: operation,
        value: duration,
        threshold,
      });
    }
  }

  /**
   * Sanitize key for privacy
   */
  private sanitizeKey(key: string): string {
    // Remove potentially sensitive information
    return key
      .replace(
        /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g,
        "[uuid]",
      )
      .replace(/\b\d{4,}\b/g, "[number]")
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, "[email]");
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Set custom user properties
   */
  setUserProperties(properties: Record<string, any>): void {
    this.track("user_properties", properties);
  }

  /**
   * Identify user (update user ID)
   */
  identify(userId: string, properties?: Record<string, any>): void {
    this.userId = userId;
    this.track("identify", {
      userId,
      properties,
    });
  }

  /**
   * Create a timing tracker
   */
  startTiming(name: string): () => number {
    const startTime = performance.now();

    return () => {
      const duration = performance.now() - startTime;
      this.track("timing", {
        name,
        duration,
      });
      return duration;
    };
  }

  /**
   * Track page view or screen view
   */
  trackView(name: string, properties?: Record<string, any>): void {
    this.track("view", {
      name,
      ...properties,
    });
  }

  /**
   * Get analytics statistics
   */
  getStatistics(): AnalyticsStatistics {
    return {
      sessionId: this.sessionId,
      sessionStart: this.sessionStart,
      eventQueue: this.eventQueue.length,
      performanceMetrics: this.getPerformanceMetrics(),
      isEnabled: this.config.enabled,
      lastFlush: Date.now(), // This would be tracked properly in real implementation
    };
  }

  /**
   * Enable/disable analytics
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;

    if (enabled) {
      this.startFlushInterval();
      if (this.config.trackPerformance) {
        this.startPerformanceMonitoring();
      }
    } else {
      this.destroy();
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = undefined;
    }

    if (this.performanceMonitorInterval) {
      clearInterval(this.performanceMonitorInterval);
      this.performanceMonitorInterval = undefined;
    }

    // Final flush
    this.flush();

    this.removeAllListeners();
  }
}

interface AnalyticsStatistics {
  sessionId: string;
  sessionStart: number;
  eventQueue: number;
  performanceMetrics: PerformanceMetrics;
  isEnabled: boolean;
  lastFlush: number;
}
