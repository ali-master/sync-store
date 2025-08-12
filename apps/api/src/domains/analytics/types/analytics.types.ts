export interface ApiKeyAnalytics {
  apiKeyId: string;
  keyName: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  peakUsageHour: number;
  quotaUtilization: number;
  topEndpoints: EndpointUsage[];
  errorRates: ErrorRate[];
  geographicDistribution: GeographicUsage[];
  timeSeriesData: TimeSeriesPoint[];
}

export interface UserAnalytics {
  userId: string;
  totalSessions: number;
  totalOperations: number;
  storageUsage: StorageUsage;
  deviceTypes: DeviceTypeUsage[];
  activityPatterns: ActivityPattern[];
  conflictRate: number;
  averageSessionDuration: number;
  mostActiveHours: number[];
  syncFrequency: SyncFrequency;
  featureUsage: FeatureUsage[];
}

export interface InstanceAnalytics {
  instanceId: string;
  userId: string;
  deviceInfo: DeviceInfo;
  sessionMetrics: SessionMetrics;
  syncMetrics: SyncMetrics;
  performanceMetrics: PerformanceMetrics;
  networkMetrics: NetworkMetrics;
  errorMetrics: ErrorMetrics;
  usageHistory: UsageHistoryPoint[];
}

export interface EndpointUsage {
  endpoint: string;
  method: string;
  count: number;
  averageResponseTime: number;
  errorRate: number;
}

export interface ErrorRate {
  errorType: string;
  count: number;
  percentage: number;
  lastOccurred: Date;
}

export interface GeographicUsage {
  country: string;
  city?: string;
  requestCount: number;
  uniqueUsers: number;
  averageResponseTime: number;
}

export interface TimeSeriesPoint {
  timestamp: Date;
  requests: number;
  responseTime: number;
  errors: number;
  activeUsers: number;
}

export interface StorageUsage {
  totalItems: number;
  totalSizeBytes: number;
  averageItemSize: number;
  largestItem: {
    key: string;
    sizeBytes: number;
  };
  oldestItem: {
    key: string;
    age: number;
  };
  mostAccessedItems: {
    key: string;
    accessCount: number;
  }[];
}

export interface DeviceTypeUsage {
  deviceType: string;
  count: number;
  percentage: number;
  averageSessionDuration: number;
}

export interface ActivityPattern {
  hour: number;
  dayOfWeek: number;
  operationCount: number;
  averageResponseTime: number;
}

export interface SyncFrequency {
  daily: number;
  weekly: number;
  monthly: number;
  averageInterval: number;
}

export interface FeatureUsage {
  featureName: string;
  usageCount: number;
  lastUsed: Date;
  successRate: number;
}

export interface DeviceInfo {
  type: string;
  os: string;
  browser?: string;
  version?: string;
  screenResolution?: string;
  timeZone: string;
}

export interface SessionMetrics {
  totalSessions: number;
  averageSessionDuration: number;
  longestSession: number;
  shortestSession: number;
  currentSessionDuration?: number;
  sessionStartTime?: Date;
  lastActivity: Date;
}

export interface SyncMetrics {
  totalSyncOperations: number;
  successfulSyncs: number;
  failedSyncs: number;
  averageSyncTime: number;
  conflictsGenerated: number;
  conflictsResolved: number;
  dataTransferred: number;
  compressionRatio: number;
}

export interface PerformanceMetrics {
  averageLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  memoryUsage: number;
  cpuUsage: number;
  networkThroughput: number;
}

export interface NetworkMetrics {
  packetsReceived: number;
  packetsSent: number;
  bytesReceived: number;
  bytesSent: number;
  connectionType: string;
  averageBandwidth: number;
  packetLoss: number;
}

export interface ErrorMetrics {
  totalErrors: number;
  errorsByType: Record<string, number>;
  errorsByEndpoint: Record<string, number>;
  criticalErrors: number;
  lastError?: {
    type: string;
    message: string;
    timestamp: Date;
  };
}

export interface UsageHistoryPoint {
  timestamp: Date;
  operations: number;
  responseTime: number;
  errors: number;
  storageUsage: number;
}

export interface AnalyticsTimeRange {
  start: Date;
  end: Date;
  granularity: "minute" | "hour" | "day" | "week" | "month";
}

export interface AnalyticsFilter {
  apiKeys?: string[];
  userIds?: string[];
  instanceIds?: string[];
  endpoints?: string[];
  errorTypes?: string[];
  countries?: string[];
  deviceTypes?: string[];
}

export interface AnalyticsAggregation {
  totalRequests: number;
  totalUsers: number;
  totalApiKeys: number;
  totalInstances: number;
  averageResponseTime: number;
  errorRate: number;
  topApiKeys: {
    id: string;
    name: string;
    requests: number;
  }[];
  topUsers: {
    id: string;
    requests: number;
    lastActive: Date;
  }[];
  topInstances: {
    id: string;
    userId: string;
    requests: number;
  }[];
  geographicBreakdown: GeographicUsage[];
  timeSeriesData: TimeSeriesPoint[];
}

export enum AnalyticsEventType {
  REQUEST = "request",
  RESPONSE = "response",
  ERROR = "error",
  SYNC = "sync",
  CONFLICT = "conflict",
  SESSION_START = "session_start",
  SESSION_END = "session_end",
  QUOTA_EXCEEDED = "quota_exceeded",
  API_KEY_CREATED = "api_key_created",
  API_KEY_REVOKED = "api_key_revoked",
}

export interface AnalyticsEvent {
  id: string;
  type: AnalyticsEventType;
  apiKeyId?: string;
  userId?: string;
  instanceId?: string;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  responseTime?: number;
  errorType?: string;
  errorMessage?: string;
  ipAddress?: string;
  userAgent?: string;
  country?: string;
  city?: string;
  metadata?: Record<string, any>;
  timestamp: Date;
}
