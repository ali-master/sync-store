import type { StorageItem, SyncEvent, SyncFilter, BatchOperation, BatchResult } from "../types";

/**
 * Transport mode configuration for the sync client
 *
 * @enum {string}
 * @property {string} HTTP - Use HTTP REST exclusively
 * @property {string} WEBSOCKET - Use WebSocket exclusively
 * @property {string} AUTO - Automatically select and fallback between protocols
 */
export enum TransportMode {
  HTTP = "http",
  WEBSOCKET = "websocket",
  AUTO = "auto",
}

/**
 * Configuration for transport layer
 *
 * @interface TransportConfig
 * @property {string} serverUrl - The server URL to connect to
 * @property {TransportMode} mode - The transport mode to use
 * @property {string} userId - The user identifier
 * @property {string} instanceId - The unique instance identifier
 * @property {string} [apiKey] - Optional API key for authentication
 * @property {number} [timeout] - Request timeout in milliseconds
 * @property {boolean} [reconnection] - Enable automatic reconnection for WebSocket
 * @property {RetryConfig} [retry] - Retry configuration for failed requests
 */
export interface TransportConfig {
  serverUrl: string;
  mode: TransportMode;
  userId: string;
  instanceId: string;
  apiKey?: string;
  timeout?: number;
  reconnection?: boolean;
  retry?: {
    maxAttempts: number;
    backoffStrategy: "linear" | "exponential";
    baseDelay: number;
    maxDelay: number;
    jitter?: boolean;
  };
}

/**
 * Transport operation response
 *
 * @interface TransportResponse
 * @template T - The type of data in the response
 * @property {boolean} success - Whether the operation was successful
 * @property {T} [data] - The response data if successful
 * @property {string} [error] - Error message if failed
 * @property {Record<string, any>} [metadata] - Additional metadata
 */
export interface TransportResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: Record<string, any>;
}

/**
 * Transport connection state
 *
 * @enum {string}
 */
export enum TransportState {
  DISCONNECTED = "disconnected",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  RECONNECTING = "reconnecting",
  ERROR = "error",
}

/**
 * Transport event types
 *
 * @interface TransportEvents
 */
export interface TransportEvents {
  connect: void;
  disconnect: { reason?: string };
  error: { type: string; message: string; error?: any };
  reconnect: { attempt: number };
  "sync:update": SyncEvent;
  "sync:remove": SyncEvent;
  "sync:conflict": any;
  "pending-updates": SyncEvent[];
  "state-change": TransportState;
}

/**
 * Unified transport interface for both WebSocket and HTTP REST
 *
 * This interface abstracts the communication protocol details and provides
 * a consistent API for the RemoteStorage class to interact with the server
 * regardless of the underlying transport mechanism.
 *
 * @interface ITransport
 */
export interface ITransport {
  /**
   * Get current transport state
   *
   * @returns {TransportState} Current connection state
   */
  getState(): TransportState;

  /**
   * Connect to the server
   *
   * @returns {Promise<void>} Resolves when connected
   * @throws {Error} If connection fails
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the server
   *
   * @returns {void}
   */
  disconnect(): void;

  /**
   * Check if currently connected
   *
   * @returns {boolean} True if connected
   */
  isConnected(): boolean;

  /**
   * Set an item on the server
   *
   * @param {string} key - The storage key
   * @param {any} value - The value to store
   * @param {Record<string, any>} [metadata] - Optional metadata
   * @param {number} [version] - Optional version number
   * @param {number} [timestamp] - Optional timestamp
   * @returns {Promise<TransportResponse>} The operation result
   */
  setItem(
    key: string,
    value: any,
    metadata?: Record<string, any>,
    version?: number,
    timestamp?: number,
  ): Promise<TransportResponse>;

  /**
   * Get an item from the server
   *
   * @param {string} key - The storage key
   * @returns {Promise<TransportResponse<StorageItem>>} The item or null
   */
  getItem(key: string): Promise<TransportResponse<StorageItem | null>>;

  /**
   * Remove an item from the server
   *
   * @param {string} key - The storage key
   * @returns {Promise<TransportResponse>} The operation result
   */
  removeItem(key: string): Promise<TransportResponse>;

  /**
   * Get all items from the server
   *
   * @param {SyncFilter} [filter] - Optional filter for items
   * @returns {Promise<TransportResponse<StorageItem[]>>} Array of items
   */
  getAllItems(filter?: SyncFilter): Promise<TransportResponse<StorageItem[]>>;

  /**
   * Execute batch operations
   *
   * @param {BatchOperation[]} operations - Array of operations to execute
   * @returns {Promise<TransportResponse<BatchResult>>} Batch execution result
   */
  executeBatch(operations: BatchOperation[]): Promise<TransportResponse<BatchResult>>;

  /**
   * Get server storage information
   *
   * @returns {Promise<TransportResponse<StorageInfo>>} Storage information
   */
  getKeys(prefix?: string): Promise<TransportResponse<string[]>>;

  /**
   * Clear all storage for the user
   *
   * @returns {Promise<TransportResponse>} The operation result
   */
  clear(): Promise<TransportResponse>;

  /**
   * Get server storage information
   *
   * @returns {Promise<TransportResponse<StorageInfo>>} Storage information
   */
  getStorageInfo(): Promise<TransportResponse<StorageInfo>>;

  /**
   * Get conflict history for a storage item
   *
   * @param {string} itemId - The item ID to get conflict history for
   * @returns {Promise<TransportResponse>} Conflict history
   */
  getConflictHistory(itemId: string): Promise<TransportResponse>;

  /**
   * Get conflict statistics for the current user
   *
   * @param {Date} [startDate] - Start date for statistics
   * @param {Date} [endDate] - End date for statistics
   * @returns {Promise<TransportResponse>} Conflict statistics
   */
  getConflictStats(startDate?: Date, endDate?: Date): Promise<TransportResponse>;

  /**
   * Resolve a specific conflict
   *
   * @param {string} conflictId - The conflict ID to resolve
   * @param {any} resolveDto - The resolution strategy and options
   * @returns {Promise<TransportResponse>} Resolution result
   */
  resolveConflict(conflictId: string, resolveDto: any): Promise<TransportResponse>;

  /**
   * Analyze potential conflicts for given data
   *
   * @param {any} data - The data to analyze for conflicts
   * @returns {Promise<TransportResponse>} Conflict analysis
   */
  analyzeConflict(data: any): Promise<TransportResponse>;

  /**
   * Get available conflict resolution strategies
   *
   * @returns {Promise<TransportResponse>} Available strategies
   */
  getConflictStrategies(): Promise<TransportResponse>;

  /**
   * Subscribe to real-time updates for specific keys
   *
   * @param {string[]} keys - Array of keys to subscribe to
   * @returns {Promise<void>}
   */
  subscribe(keys: string[]): Promise<void>;

  /**
   * Unsubscribe from real-time updates
   *
   * @param {string[]} keys - Array of keys to unsubscribe from
   * @returns {Promise<void>}
   */
  unsubscribe(keys: string[]): Promise<void>;

  /**
   * Add event listener
   *
   * @param {K} event - Event name
   * @param {Function} listener - Event listener function
   */
  on<K extends keyof TransportEvents>(event: K, listener: (data: TransportEvents[K]) => void): void;

  /**
   * Remove event listener
   *
   * @param {K} event - Event name
   * @param {Function} listener - Event listener function
   */
  off<K extends keyof TransportEvents>(
    event: K,
    listener: (data: TransportEvents[K]) => void,
  ): void;

  /**
   * Remove all event listeners for an event
   *
   * @param {K} [event] - Event name, or all if not specified
   */
  removeAllListeners<K extends keyof TransportEvents>(event?: K): void;

  /**
   * Get transport type
   *
   * @returns {TransportMode} The transport mode being used
   */
  getType(): TransportMode;

  /**
   * Destroy the transport and clean up resources
   *
   * @returns {void}
   */
  destroy(): void;
}

/**
 * Storage information from server
 *
 * @interface StorageInfo
 */
export interface StorageInfo {
  usagePercentage: number;
  totalSize: number;
  usedSize: number;
  itemCount?: number;
  maxItemSize?: number;
  quotaRemaining?: number;
}

/**
 * Performance metrics for transport operations
 *
 * @interface TransportMetrics
 */
export interface TransportMetrics {
  requestCount: number;
  successCount: number;
  errorCount: number;
  averageLatency: number;
  lastRequestTime?: number;
  connectionUptime?: number;
  bytesTransferred?: number;
}
