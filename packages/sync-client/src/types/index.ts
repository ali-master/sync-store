// Core types and interfaces for the sync-client library

export interface RemoteStorageConfig {
  serverUrl?: string;
  userId: string;
  instanceId?: string;
  apiKey?: string;
  autoConnect?: boolean;
  reconnection?: boolean;
  timeout?: number;
  retry?: RetryConfig;
  conflict?: ConflictConfig;
  analytics?: AnalyticsConfig;
  storage?: StorageConfig;
  debug?: DebugConfig;
  network?: NetworkConfig;
}

export interface RetryConfig {
  maxAttempts: number;
  backoffStrategy: "linear" | "exponential";
  baseDelay: number;
  maxDelay: number;
  jitter?: boolean;
}

export interface ConflictConfig {
  strategy: ConflictStrategy;
  autoResolve: boolean;
  onConflict?: (conflict: ConflictData) => Promise<any>;
  mergeStrategy?: MergeStrategy;
}

export interface AnalyticsConfig {
  enabled: boolean;
  endpoint?: string;
  trackPerformance?: boolean;
  trackErrors?: boolean;
  trackUsage?: boolean;
  customEvents?: boolean;
  batchSize?: number;
  flushInterval?: number;
}

export interface StorageConfig {
  maxSize: number;
  compressionEnabled: boolean;
  encryptionKey?: string;
  cleanupStrategy: "lru" | "fifo" | "manual";
  maxItemSize: number;
  ttl?: number;
}

export interface DebugConfig {
  logLevel: "none" | "error" | "warn" | "info" | "debug";
  performanceMonitoring: boolean;
  networkLogging: boolean;
  enableDevTools?: boolean;
}

export interface NetworkConfig {
  backgroundSync: boolean;
  backgroundInterval: number;
}

// Enums
export enum ConflictStrategy {
  LAST_WRITE_WINS = "last_write_wins",
  FIRST_WRITE_WINS = "first_write_wins",
  MERGE = "merge",
  MANUAL = "manual",
}

export enum MergeStrategy {
  DEEP_MERGE = "deep_merge",
  SHALLOW_MERGE = "shallow_merge",
  CUSTOM = "custom",
}

export enum ConnectionState {
  DISCONNECTED = "disconnected",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  RECONNECTING = "reconnecting",
  DEGRADED = "degraded",
  ERROR = "error",
}

export enum ErrorType {
  NETWORK = "network",
  SERVER = "server",
  AUTHENTICATION = "authentication",
  QUOTA = "quota",
  CONFLICT = "conflict",
  VALIDATION = "validation",
  STORAGE = "storage",
}

export enum SyncMode {
  REALTIME = "realtime",
  BACKGROUND = "background",
  MANUAL = "manual",
  BATCH = "batch",
}

// Data structures
export interface StorageItem<T = any> {
  key: string;
  value: T;
  metadata?: Record<string, any>;
  version?: number;
  timestamp?: number;
  size?: number;
  ttl?: number;
  tags?: string[];
}

export interface ConflictData<T = any> {
  id: string;
  key: string;
  localValue: T;
  remoteValue: T;
  localVersion: number;
  remoteVersion: number;
  localTimestamp: number;
  remoteTimestamp: number;
  conflictType: "version_mismatch" | "concurrent_update" | "schema_change";
  metadata?: Record<string, any>;
}

export interface SyncEvent<T = any> {
  type: "sync" | "remove" | "clear" | "conflict" | "batch";
  key?: string;
  value?: T;
  metadata?: Record<string, any>;
  timestamp: number;
  version?: number;
  source: "local" | "remote";
  instanceId?: string;
}

export interface BatchOperation {
  type: "set" | "remove" | "get";
  key: string;
  value?: any;
  metadata?: Record<string, any>;
}

export interface BatchResult {
  success: boolean;
  operations: Array<{
    operation: BatchOperation;
    success: boolean;
    error?: string;
    result?: any;
  }>;
  totalTime: number;
}

// Simplified network info - removed complex NetworkQuality interface

export interface PerformanceMetrics {
  syncLatency: number[];
  memoryUsage: number;
  operationTimes: Record<string, number>;
  isOnline: boolean;
  errorCount: Record<ErrorType, number>;
  cacheHitRate: number;
}

export interface AnalyticsEvent {
  type: string;
  data: Record<string, any>;
  timestamp: number;
  userId: string;
  instanceId: string;
  sessionId: string;
}

export interface SyncFilter {
  includePatterns?: string[];
  excludePatterns?: string[];
  maxItemSize?: number;
  syncOnlyRecent?: boolean;
  tags?: string[];
}

export interface ConnectionInfo {
  state: ConnectionState;
  connectedAt?: number;
  lastActivity?: number;
  isOnline?: boolean;
  reconnectAttempts: number;
  error?: string;
}

// Event types
export type StorageEventType =
  | "change"
  | "sync"
  | "connect"
  | "disconnect"
  | "reconnect"
  | "error"
  | "conflict"
  | "network-change"
  | "quota-exceeded"
  | "performance-warning";

export interface ChangeEvent<T = any> {
  key: string;
  oldValue: T | null;
  newValue: T | null;
  source: "local" | "remote";
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface NetworkChangeEvent {
  state: ConnectionState;
  isOnline: boolean;
  timestamp: number;
}

// Plugin system
export interface Plugin {
  name: string;
  version: string;
  install(storage: any): void;
  uninstall(storage: any): void;
}

export interface PluginHooks {
  beforeSync?: (data: any) => Promise<any>;
  afterSync?: (data: any) => Promise<void>;
  onConflict?: (conflict: ConflictData) => Promise<any>;
  onError?: (error: Error) => Promise<void>;
}

// React hook types
export interface UseRemoteStorageOptions extends Partial<RemoteStorageConfig> {
  suspense?: boolean;
  errorBoundary?: boolean;
}

export interface UseStorageItemOptions<T> {
  defaultValue?: T;
  conflictStrategy?: ConflictStrategy;
  syncMode?: SyncMode;
  cacheTTL?: number;
  validator?: (value: any) => value is T;
  transform?: {
    serialize?: (value: T) => any;
    deserialize?: (value: any) => T;
  };
}

export interface UseStorageItemResult<T> {
  value: T;
  setValue: (value: T) => Promise<void>;
  loading: boolean;
  error: Error | null;
  syncing: boolean;
  lastSynced?: number;
  version?: number;
  conflicts: ConflictData[];
  resolveConflict: (conflictId: string, resolution: any) => Promise<void>;
}

// Utility types
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type Awaitable<T> = T | Promise<T>;

export type EventListener<T = any> = (event: T) => void | Promise<void>;

export type UnsubscribeFn = () => void;
