/**
 * Comprehensive logging utility with multiple levels and outputs
 */

export enum LogLevel {
  NONE = 0,
  ERROR = 1,
  WARN = 2,
  INFO = 3,
  DEBUG = 4,
}

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  context: string;
  message: string;
  data?: any;
  metadata?: Record<string, any>;
}

export interface LogOutput {
  write(entry: LogEntry): void;
  flush?(): Promise<void>;
  destroy?(): void;
}

export interface LogFormatter {
  format(entry: LogEntry): string;
}

export class ConsoleOutput implements LogOutput {
  write(entry: LogEntry): void {
    const levelName = LogLevel[entry.level];
    const timestamp = entry.timestamp.toISOString();
    const prefix = `[${timestamp}] [${levelName}] [${entry.context}]`;

    const message = entry.data
      ? `${prefix} ${entry.message} ${JSON.stringify(entry.data, null, 2)}`
      : `${prefix} ${entry.message}`;

    switch (entry.level) {
      case LogLevel.ERROR:
        console.error(message);
        break;
      case LogLevel.WARN:
        console.warn(message);
        break;
      case LogLevel.INFO:
        console.info(message);
        break;
      case LogLevel.DEBUG:
        console.debug(message);
        break;
    }
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

export class Logger {
  private static globalLevel: LogLevel = LogLevel.INFO;
  private static outputs: LogOutput[] = [new ConsoleOutput()];

  constructor(private context: string = "SyncClient") {}

  /**
   * Log debug message
   */
  debug(message: string, data?: any): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  /**
   * Log info message
   */
  info(message: string, data?: any): void {
    this.log(LogLevel.INFO, message, data);
  }

  /**
   * Log warning message
   */
  warn(message: string, data?: any): void {
    this.log(LogLevel.WARN, message, data);
  }

  /**
   * Log error message
   */
  error(message: string, data?: any): void {
    this.log(LogLevel.ERROR, message, data);
  }

  /**
   * Core logging method
   */
  private log(level: LogLevel, message: string, data?: any): void {
    if (level > Logger.globalLevel) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      context: this.context,
      message,
      data,
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
   * Create child logger with extended context
   */
  child(context: string): Logger {
    return new Logger(`${this.context}:${context}`);
  }

  /**
   * Create logger with specific level
   */
  withLevel(level: LogLevel): Logger {
    const logger = new Logger(this.context);
    Logger.setLevel(level);
    return logger;
  }
}

// Convenience functions
export const createLogger = (context: string): Logger => new Logger(context);
export const setLogLevel = (level: LogLevel): void => Logger.setLevel(level);
export const addLogOutput = (output: LogOutput): void => Logger.addOutput(output);
