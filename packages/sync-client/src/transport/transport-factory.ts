import { HttpTransport } from "./http-transport";
import { WebSocketTransport } from "./websocket-transport";
import { AutoTransport } from "./auto-transport";
import { Logger } from "../utils/logger";
import type { ITransport, TransportConfig } from "./types";
import { TransportMode } from "./types";

/**
 * Factory class for creating transport instances based on configuration
 *
 * This factory encapsulates the logic for instantiating the appropriate
 * transport implementation based on the specified mode. It supports
 * HTTP-only, WebSocket-only, and automatic mode selection with fallback.
 *
 * @class TransportFactory
 */
export class TransportFactory {
  private static logger = new Logger("TransportFactory");

  /**
   * Create a transport instance based on configuration
   *
   * @static
   * @param {TransportConfig} config - Transport configuration
   * @returns {ITransport} The created transport instance
   * @throws {Error} If an invalid transport mode is specified
   *
   * @example
   * ```typescript
   * // Create HTTP-only transport
   * const httpTransport = TransportFactory.create({
   *   mode: TransportMode.HTTP,
   *   serverUrl: "https://api.example.com",
   *   userId: "user123",
   *   instanceId: "instance456"
   * });
   *
   * // Create WebSocket-only transport
   * const wsTransport = TransportFactory.create({
   *   mode: TransportMode.WEBSOCKET,
   *   serverUrl: "wss://api.example.com",
   *   userId: "user123",
   *   instanceId: "instance456"
   * });
   *
   * // Create auto-selecting transport with fallback
   * const autoTransport = TransportFactory.create({
   *   mode: TransportMode.AUTO,
   *   serverUrl: "https://api.example.com",
   *   userId: "user123",
   *   instanceId: "instance456"
   * });
   * ```
   */
  static create(config: TransportConfig): ITransport {
    this.logger.info(`Creating transport with mode: ${config.mode}`, {
      serverUrl: config.serverUrl,
      userId: config.userId,
    });

    switch (config.mode) {
      case TransportMode.HTTP:
      case "http":
        return this.createHttpTransport(config);

      case TransportMode.WEBSOCKET:
      case "websocket":
        return this.createWebSocketTransport(config);

      case TransportMode.AUTO:
      case "auto":
        return this.createAutoTransport(config);

      default:
        throw new Error(`Invalid transport mode: ${config.mode}`);
    }
  }

  /**
   * Create an HTTP transport instance
   *
   * @private
   * @static
   * @param {TransportConfig} config - Transport configuration
   * @returns {HttpTransport} HTTP transport instance
   */
  private static createHttpTransport(config: TransportConfig): HttpTransport {
    this.logger.debug("Creating HTTP transport");

    const transport = new HttpTransport(config);

    this.logger.info("HTTP transport created successfully");
    return transport;
  }

  /**
   * Create a WebSocket transport instance
   *
   * @private
   * @static
   * @param {TransportConfig} config - Transport configuration
   * @returns {WebSocketTransport} WebSocket transport instance
   */
  private static createWebSocketTransport(config: TransportConfig): WebSocketTransport {
    this.logger.debug("Creating WebSocket transport");

    const transport = new WebSocketTransport(config);

    this.logger.info("WebSocket transport created successfully");
    return transport;
  }

  /**
   * Create an auto transport instance
   *
   * @private
   * @static
   * @param {TransportConfig} config - Transport configuration
   * @returns {AutoTransport} Auto transport instance
   */
  private static createAutoTransport(config: TransportConfig): AutoTransport {
    this.logger.debug("Creating Auto transport with intelligent fallback");

    const transport = new AutoTransport(config);

    this.logger.info("Auto transport created successfully");
    return transport;
  }

  /**
   * Validate transport configuration
   *
   * @static
   * @param {TransportConfig} config - Configuration to validate
   * @returns {boolean} True if valid
   * @throws {Error} If configuration is invalid
   */
  static validateConfig(config: TransportConfig): boolean {
    if (!config.serverUrl) {
      throw new Error("serverUrl is required");
    }

    if (!config.userId) {
      throw new Error("userId is required");
    }

    if (!config.instanceId) {
      throw new Error("instanceId is required");
    }

    if (!config.mode) {
      throw new Error("transport mode is required");
    }

    const validModes = Object.values(TransportMode);
    if (!validModes.includes(config.mode as TransportMode)) {
      throw new Error(
        `Invalid transport mode: ${config.mode}. Valid modes are: ${validModes.join(", ")}`,
      );
    }

    // Validate URL format
    try {
      new URL(config.serverUrl);
    } catch {
      throw new Error(`Invalid serverUrl: ${config.serverUrl}`);
    }

    // Validate timeout if provided
    if (config.timeout !== undefined && config.timeout <= 0) {
      throw new Error("timeout must be a positive number");
    }

    // Validate retry config if provided
    if (config.retry) {
      if (config.retry.maxAttempts < 1) {
        throw new Error("retry.maxAttempts must be at least 1");
      }

      if (config.retry.baseDelay <= 0) {
        throw new Error("retry.baseDelay must be positive");
      }

      if (config.retry.maxDelay <= config.retry.baseDelay) {
        throw new Error("retry.maxDelay must be greater than baseDelay");
      }

      const validStrategies = ["linear", "exponential"];
      if (!validStrategies.includes(config.retry.backoffStrategy)) {
        throw new Error(`Invalid backoff strategy: ${config.retry.backoffStrategy}`);
      }
    }

    return true;
  }

  /**
   * Get recommended transport mode based on environment
   *
   * @static
   * @returns {TransportMode} Recommended transport mode
   */
  static getRecommendedMode(): TransportMode {
    // In browser environment
    if (typeof window !== "undefined") {
      // Check if WebSocket is available
      if (typeof WebSocket !== "undefined") {
        return TransportMode.AUTO; // Use auto mode with fallback
      } else {
        return TransportMode.HTTP; // Fallback to HTTP only
      }
    }

    // In Node.js environment
    return TransportMode.AUTO; // Default to auto mode
  }

  /**
   * Check if a transport mode is supported in current environment
   *
   * @static
   * @param {TransportMode} mode - Transport mode to check
   * @returns {boolean} True if supported
   */
  static isSupported(mode: TransportMode): boolean {
    switch (mode) {
      case TransportMode.HTTP:
        // HTTP is always supported
        return true;

      case TransportMode.WEBSOCKET:
        // Check WebSocket availability
        if (typeof window !== "undefined") {
          return typeof WebSocket !== "undefined";
        }
        // In Node.js, socket.io-client handles it
        return true;

      case TransportMode.AUTO:
        // Auto mode is always available (will fallback as needed)
        return true;

      default:
        return false;
    }
  }

  /**
   * Get information about available transport modes
   *
   * @static
   * @returns {Object} Transport mode information
   */
  static getAvailableModes(): {
    modes: TransportMode[];
    recommended: TransportMode;
    environment: "browser" | "node";
  } {
    const modes: TransportMode[] = [];

    if (this.isSupported(TransportMode.HTTP)) {
      modes.push(TransportMode.HTTP);
    }

    if (this.isSupported(TransportMode.WEBSOCKET)) {
      modes.push(TransportMode.WEBSOCKET);
    }

    if (this.isSupported(TransportMode.AUTO)) {
      modes.push(TransportMode.AUTO);
    }

    return {
      modes,
      recommended: this.getRecommendedMode(),
      environment: typeof window !== "undefined" ? "browser" : "node",
    };
  }
}

/**
 * Convenience function to create a transport
 *
 * @param {TransportConfig} config - Transport configuration
 * @returns {ITransport} Created transport instance
 *
 * @example
 * ```typescript
 * import { createTransport, TransportMode } from "@usex/sync-client";
 *
 * const transport = createTransport({
 *   mode: TransportMode.AUTO,
 *   serverUrl: "https://api.example.com",
 *   userId: "user123",
 *   instanceId: "instance456",
 *   timeout: 10000,
 *   retry: {
 *     maxAttempts: 3,
 *     backoffStrategy: "exponential",
 *     baseDelay: 1000,
 *     maxDelay: 10000
 *   }
 * });
 * ```
 */
export function createTransport(config: TransportConfig): ITransport {
  return TransportFactory.create(config);
}
