/**
 * Log levels enumeration
 *
 * @enum {number}
 */
export enum LogLevel {
  NONE = 0,
  ERROR = 1,
  WARN = 2,
  INFO = 3,
  DEBUG = 4,
  TRACE = 5,
}

/**
 * ANSI color codes for terminal output
 *
 * @enum {string}
 */
export enum LogColors {
  RESET = "\x1b[0m",
  BRIGHT = "\x1b[1m",
  DIM = "\x1b[2m",
  RED = "\x1b[31m",
  YELLOW = "\x1b[33m",
  BLUE = "\x1b[34m",
  CYAN = "\x1b[36m",
  MAGENTA = "\x1b[35m",
  GREEN = "\x1b[32m",
  GRAY = "\x1b[90m",
}

/**
 * Log entry structure
 *
 * @interface LogEntry
 */
export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  context: string;
  message: string;
  data?: any;
  metadata?: Record<string, any>;
  duration?: number; // For performance tracking
  error?: Error; // For error logging
}

export interface LogOutput {
  write(entry: LogEntry): void;
  flush?(): Promise<void>;
  destroy?(): void;
}

export interface LogFormatter {
  format(entry: LogEntry): string;
}

/**
 * Colored console output implementation
 *
 * @class ColoredConsoleOutput
 * @implements {LogOutput}
 */
export class ColoredConsoleOutput implements LogOutput {
  private useColors: boolean;
  private showTimestamp: boolean;
  private showContext: boolean;

  constructor(
    options: {
      useColors?: boolean;
      showTimestamp?: boolean;
      showContext?: boolean;
    } = {},
  ) {
    // Auto-detect color support
    this.useColors = options.useColors ?? this.supportsColor();
    this.showTimestamp = options.showTimestamp ?? true;
    this.showContext = options.showContext ?? true;
  }

  write(entry: LogEntry): void {
    const formatted = this.formatEntry(entry);

    switch (entry.level) {
      case LogLevel.ERROR:
        console.error(formatted);
        if (entry.error?.stack) {
          console.error(this.colorize(entry.error.stack, LogColors.DIM));
        }
        break;
      case LogLevel.WARN:
        console.warn(formatted);
        break;
      case LogLevel.INFO:
        console.info(formatted);
        break;
      case LogLevel.DEBUG:
        console.debug(formatted);
        break;
      case LogLevel.TRACE:
        console.log(formatted);
        break;
    }
  }

  private formatEntry(entry: LogEntry): string {
    const parts: string[] = [];

    // Timestamp
    if (this.showTimestamp) {
      const timestamp = this.formatTimestamp(entry.timestamp);
      parts.push(this.colorize(`[${timestamp}]`, LogColors.GRAY));
    }

    // Level
    const levelStr = this.formatLevel(entry.level);
    const levelColor = this.getLevelColor(entry.level);
    parts.push(this.colorize(levelStr, levelColor));

    // Context
    if (this.showContext) {
      parts.push(this.colorize(`[${entry.context}]`, LogColors.CYAN));
    }

    // Message
    parts.push(entry.message);

    // Duration (if provided)
    if (entry.duration !== undefined) {
      const durationStr = `(${entry.duration.toFixed(2)}ms)`;
      parts.push(this.colorize(durationStr, LogColors.MAGENTA));
    }

    // Data
    if (entry.data) {
      const dataStr = this.formatData(entry.data);
      parts.push(this.colorize(dataStr, LogColors.DIM));
    }

    return parts.join(" ");
  }

  private formatTimestamp(date: Date): string {
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    const seconds = date.getSeconds().toString().padStart(2, "0");
    const ms = date.getMilliseconds().toString().padStart(3, "0");
    return `${hours}:${minutes}:${seconds}.${ms}`;
  }

  private formatLevel(level: LogLevel): string {
    const levelName = LogLevel[level];
    return `[${levelName.padEnd(5)}]`;
  }

  private formatData(data: any): string {
    if (typeof data === "string") {
      return data;
    }
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  }

  private getLevelColor(level: LogLevel): string {
    switch (level) {
      case LogLevel.ERROR:
        return LogColors.RED;
      case LogLevel.WARN:
        return LogColors.YELLOW;
      case LogLevel.INFO:
        return LogColors.GREEN;
      case LogLevel.DEBUG:
        return LogColors.BLUE;
      case LogLevel.TRACE:
        return LogColors.GRAY;
      default:
        return LogColors.RESET;
    }
  }

  private colorize(text: string, color: string): string {
    if (!this.useColors) {
      return text;
    }
    return `${color}${text}${LogColors.RESET}`;
  }

  private supportsColor(): boolean {
    // Check if running in browser
    if (typeof window !== "undefined") {
      // Browser console supports colors via CSS
      return false; // We'll use regular console for browser
    }

    // Check Node.js environment
    if (typeof process !== "undefined") {
      // Check for color support in terminal
      return process.stdout?.isTTY && process.env.TERM !== "dumb";
    }

    return false;
  }
}

/**
 * Legacy console output for compatibility
 *
 * @class ConsoleOutput
 * @implements {LogOutput}
 */
export class ConsoleOutput extends ColoredConsoleOutput {
  constructor() {
    super({ useColors: false });
  }
}

export class FileOutput implements LogOutput {
  private buffer: string[] = [];
  private flushTimer?: NodeJS.Timeout;

  constructor(
    private filename: string,
    private maxBufferSize: number = 100,
    private flushInterval: number = 5000,
  ) {
    this.scheduleFlush();
  }

  write(entry: LogEntry): void {
    const formatter = new DefaultFormatter();
    this.buffer.push(formatter.format(entry));

    if (this.buffer.length >= this.maxBufferSize) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    // In browser environment, we can't write to files
    if (typeof window !== "undefined") {
      console.warn("FileOutput not available in browser environment");
      this.buffer = [];
      return;
    }

    try {
      const content = this.buffer.join("\n") + "\n";
      this.buffer = [];
      // Note: In a real implementation, you'd use fs.appendFile here
      console.log(`Would write to ${this.filename}:`, content);
    } catch (error) {
      console.error("Failed to write log file:", error);
    }
  }

  private scheduleFlush(): void {
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.flushInterval);
  }

  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    void this.flush();
  }
}

export class BufferedOutput implements LogOutput {
  private entries: LogEntry[] = [];

  constructor(private maxSize: number = 1000) {}

  write(entry: LogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxSize) {
      this.entries.shift();
    }
  }

  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }
}

export class DefaultFormatter implements LogFormatter {
  format(entry: LogEntry): string {
    const timestamp = entry.timestamp.toISOString();
    const level = LogLevel[entry.level].padEnd(5);
    const context = entry.context.padEnd(15);

    let formatted = `${timestamp} ${level} ${context} ${entry.message}`;

    if (entry.data) {
      formatted += ` ${JSON.stringify(entry.data)}`;
    }

    return formatted;
  }
}

export class JSONFormatter implements LogFormatter {
  format(entry: LogEntry): string {
    return JSON.stringify({
      timestamp: entry.timestamp.toISOString(),
      level: LogLevel[entry.level],
      context: entry.context,
      message: entry.message,
      data: entry.data,
      metadata: entry.metadata,
    });
  }
}

/**
 * Performance tracking utility
 *
 * @class PerformanceTracker
 */
export class PerformanceTracker {
  private startTime: number;

  constructor() {
    this.startTime = performance.now();
  }

  /**
   * Get elapsed time in milliseconds
   *
   * @returns {number} Elapsed time
   */
  elapsed(): number {
    return performance.now() - this.startTime;
  }

  /**
   * Reset the timer
   */
  reset(): void {
    this.startTime = performance.now();
  }
}

/**
 * Main logger class with enhanced features
 *
 * @class Logger
 */
export class Logger {
  private static globalLevel: LogLevel = LogLevel.INFO;
  private static outputs: LogOutput[] = [new ColoredConsoleOutput()];
  private static performanceMetrics: Map<string, number[]> = new Map();
  private static metricsEnabled = false;

  constructor(private context: string = "SyncClient") {}

  /**
   * Log trace message (most verbose)
   *
   * @param {string} message - Log message
   * @param {any} [data] - Additional data
   */
  trace(message: string, data?: any): void {
    this.log(LogLevel.TRACE, message, data);
  }

  /**
   * Log debug message
   *
   * @param {string} message - Log message
   * @param {any} [data] - Additional data
   */
  debug(message: string, data?: any): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  /**
   * Log info message
   *
   * @param {string} message - Log message
   * @param {any} [data] - Additional data
   */
  info(message: string, data?: any): void {
    this.log(LogLevel.INFO, message, data);
  }

  /**
   * Log warning message
   *
   * @param {string} message - Log message
   * @param {any} [data] - Additional data
   */
  warn(message: string, data?: any): void {
    this.log(LogLevel.WARN, message, data);
  }

  /**
   * Log error message
   *
   * @param {string} message - Log message
   * @param {any} [data] - Additional data or Error object
   */
  error(message: string, data?: any): void {
    const error = data instanceof Error ? data : undefined;
    const additionalData = data instanceof Error ? { error: data.message } : data;

    this.log(LogLevel.ERROR, message, additionalData, undefined, error);
  }

  /**
   * Log a performance metric
   *
   * @param {string} operation - Operation name
   * @param {number} duration - Duration in milliseconds
   * @param {any} [data] - Additional data
   */
  perf(operation: string, duration: number, data?: any): void {
    if (Logger.metricsEnabled) {
      this.trackMetric(operation, duration);
    }

    this.log(LogLevel.DEBUG, `Performance: ${operation}`, data, duration);
  }

  /**
   * Start a performance timer
   *
   * @param {string} operation - Operation name
   * @returns {() => void} Function to stop timer and log
   */
  startTimer(operation: string): () => void {
    const tracker = new PerformanceTracker();

    return () => {
      const duration = tracker.elapsed();
      this.perf(operation, duration);
    };
  }

  /**
   * Track a performance metric
   *
   * @private
   * @param {string} operation - Operation name
   * @param {number} duration - Duration in milliseconds
   */
  private trackMetric(operation: string, duration: number): void {
    const key = `${this.context}:${operation}`;
    const metrics = Logger.performanceMetrics.get(key) || [];

    metrics.push(duration);

    // Keep only last 100 measurements
    if (metrics.length > 100) {
      metrics.shift();
    }

    Logger.performanceMetrics.set(key, metrics);
  }

  /**
   * Core logging method
   *
   * @private
   * @param {LogLevel} level - Log level
   * @param {string} message - Log message
   * @param {any} [data] - Additional data
   * @param {number} [duration] - Operation duration
   * @param {Error} [error] - Error object
   */
  private log(
    level: LogLevel,
    message: string,
    data?: any,
    duration?: number,
    error?: Error,
  ): void {
    if (level > Logger.globalLevel) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      context: this.context,
      message,
      data,
      duration,
      error,
      metadata: {
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        url: typeof window !== "undefined" ? window.location?.href : undefined,
      },
    };

    Logger.outputs.forEach((output) => {
      try {
        output.write(entry);
      } catch (error) {
        console.error("Failed to write log entry:", error);
      }
    });
  }

  /**
   * Set global log level
   */
  static setLevel(level: LogLevel): void {
    Logger.globalLevel = level;
  }

  /**
   * Get current log level
   */
  static getLevel(): LogLevel {
    return Logger.globalLevel;
  }

  /**
   * Add log output
   */
  static addOutput(output: LogOutput): void {
    Logger.outputs.push(output);
  }

  /**
   * Remove log output
   */
  static removeOutput(output: LogOutput): void {
    const index = Logger.outputs.indexOf(output);
    if (index > -1) {
      Logger.outputs.splice(index, 1);
      if (output.destroy) {
        output.destroy();
      }
    }
  }

  /**
   * Clear all outputs
   */
  static clearOutputs(): void {
    Logger.outputs.forEach((output) => {
      if (output.destroy) {
        output.destroy();
      }
    });
    Logger.outputs = [];
  }

  /**
   * Flush all outputs
   */
  static async flushAll(): Promise<void> {
    await Promise.all(
      Logger.outputs.filter((output) => output.flush).map((output) => output.flush!()),
    );
  }

  /**
   * Enable/disable performance metrics
   *
   * @static
   * @param {boolean} enabled - Whether to enable metrics
   */
  static setMetricsEnabled(enabled: boolean): void {
    Logger.metricsEnabled = enabled;
  }

  /**
   * Get performance metrics for an operation
   *
   * @static
   * @param {string} [context] - Context filter
   * @param {string} [operation] - Operation filter
   * @returns {Object} Metrics summary
   */
  static getMetrics(context?: string, operation?: string): Record<string, any> {
    const results: Record<string, any> = {};

    const filter = context && operation ? `${context}:${operation}` : context ? context : "";

    Logger.performanceMetrics.forEach((metrics, key) => {
      if (!filter || key.includes(filter)) {
        const avg = metrics.reduce((a, b) => a + b, 0) / metrics.length;
        const min = Math.min(...metrics);
        const max = Math.max(...metrics);
        const p95 = this.percentile(metrics, 0.95);

        results[key] = {
          count: metrics.length,
          avg: avg.toFixed(2),
          min: min.toFixed(2),
          max: max.toFixed(2),
          p95: p95.toFixed(2),
        };
      }
    });

    return results;
  }

  /**
   * Calculate percentile
   *
   * @private
   * @static
   * @param {number[]} values - Array of values
   * @param {number} percentile - Percentile (0-1)
   * @returns {number} Percentile value
   */
  private static percentile(values: number[], percentile: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.floor(sorted.length * percentile);
    return sorted[index] || 0;
  }

  /**
   * Clear performance metrics
   *
   * @static
   */
  static clearMetrics(): void {
    Logger.performanceMetrics.clear();
  }

  /**
   * Configure logger with options
   *
   * @static
   * @param {Object} options - Configuration options
   */
  static configure(options: {
    level?: LogLevel;
    useColors?: boolean;
    showTimestamp?: boolean;
    showContext?: boolean;
    enableMetrics?: boolean;
    outputs?: LogOutput[];
  }): void {
    if (options.level !== undefined) {
      this.setLevel(options.level);
    }

    if (options.enableMetrics !== undefined) {
      this.setMetricsEnabled(options.enableMetrics);
    }

    if (options.outputs) {
      this.clearOutputs();
      options.outputs.forEach((output) => this.addOutput(output));
    } else if (
      options.useColors !== undefined ||
      options.showTimestamp !== undefined ||
      options.showContext !== undefined
    ) {
      // Reconfigure default console output
      this.clearOutputs();
      this.addOutput(
        new ColoredConsoleOutput({
          useColors: options.useColors,
          showTimestamp: options.showTimestamp,
          showContext: options.showContext,
        }),
      );
    }
  }

  /**
   * Create child logger with extended context
   *
   * @param {string} context - Child context
   * @returns {Logger} Child logger
   */
  child(context: string): Logger {
    return new Logger(`${this.context}:${context}`);
  }

  /**
   * Create logger with specific level
   *
   * @param {LogLevel} level - Log level
   * @returns {Logger} Logger with specified level
   */
  withLevel(level: LogLevel): Logger {
    const logger = new Logger(this.context);

    // Temporarily set level for this logger
    // Note: This affects global level, consider instance-level in future
    Logger.setLevel(level);

    return logger;
  }
}

/**
 * Session storage output for browser environments
 *
 * @class SessionStorageOutput
 * @implements {LogOutput}
 */
export class SessionStorageOutput implements LogOutput {
  private readonly key: string;
  private readonly maxEntries: number;

  constructor(key = "sync-client-logs", maxEntries = 100) {
    this.key = key;
    this.maxEntries = maxEntries;
  }

  write(entry: LogEntry): void {
    if (typeof window === "undefined" || !window.sessionStorage) {
      return;
    }

    try {
      const existing = this.getEntries();
      existing.push(this.serializeEntry(entry));

      // Keep only last N entries
      if (existing.length > this.maxEntries) {
        existing.splice(0, existing.length - this.maxEntries);
      }

      window.sessionStorage.setItem(this.key, JSON.stringify(existing));
    } catch {
      // Ignore storage errors (quota exceeded, etc.)
    }
  }

  private getEntries(): any[] {
    try {
      const stored = window.sessionStorage.getItem(this.key);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  private serializeEntry(entry: LogEntry): any {
    return {
      timestamp: entry.timestamp.toISOString(),
      level: LogLevel[entry.level],
      context: entry.context,
      message: entry.message,
      data: entry.data,
      duration: entry.duration,
      error: entry.error
        ? {
            message: entry.error.message,
            stack: entry.error.stack,
          }
        : undefined,
    };
  }
}

// Convenience functions
export const createLogger = (context: string): Logger => new Logger(context);
export const setLogLevel = (level: LogLevel): void => Logger.setLevel(level);
export const addLogOutput = (output: LogOutput): void => Logger.addOutput(output);
export const configureLogger = (options: Parameters<typeof Logger.configure>[0]): void =>
  Logger.configure(options);
export const getLogMetrics = (context?: string, operation?: string): Record<string, any> =>
  Logger.getMetrics(context, operation);
