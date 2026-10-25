import { Injectable } from "@nestjs/common";
import { InjectDatabase, type Database } from "@root/modules/db";
import { convertBigIntToNumber } from "@root/utils/bigint-converter.util";

import {
  InstanceAnalytics,
  AnalyticsTimeRange,
  DeviceInfo,
  SessionMetrics,
  SyncMetrics,
  PerformanceMetrics,
  NetworkMetrics,
  ErrorMetrics,
  UsageHistoryPoint,
} from "../types/analytics.types";

@Injectable()
export class InstanceAnalyticsService {
  constructor(
    @InjectDatabase()
    private readonly database: Database,
  ) {}

  /**
   * Get detailed analytics for a specific instance
   */
  async getInstanceAnalytics(
    instanceId: string,
    timeRange: AnalyticsTimeRange,
  ): Promise<InstanceAnalytics> {
    const db = this.database;

    // Get basic instance info
    const instanceInfo = await db.orm.sync_sessions
      .where({ instanceId })
      .orderBy({ connectedAt: -1 })
      .first();

    if (!instanceInfo) {
      throw new Error(`Instance ${instanceId} not found`);
    }

    // Get device info
    const deviceInfo = this.parseDeviceInfo(instanceInfo);

    // Get session metrics
    const sessionMetrics = await this.getSessionMetrics(instanceId, timeRange);

    // Get sync metrics
    const syncMetrics = await this.getSyncMetrics(instanceId, timeRange);

    // Get performance metrics
    const performanceMetrics = await this.getPerformanceMetrics(instanceId, timeRange);

    // Get network metrics
    const networkMetrics = await this.getNetworkMetrics(instanceId, timeRange);

    // Get error metrics
    const errorMetrics = await this.getErrorMetrics(instanceId, timeRange);

    // Get usage history
    const usageHistory = await this.getUsageHistory(instanceId, timeRange);

    const result = {
      instanceId,
      userId: instanceInfo.userId,
      deviceInfo,
      sessionMetrics,
      syncMetrics,
      performanceMetrics,
      networkMetrics,
      errorMetrics,
      usageHistory,
    };

    return convertBigIntToNumber(result);
  }

  /**
   * Get instance performance trends
   */
  async getInstancePerformanceTrends(instanceId: string, timeRange: AnalyticsTimeRange) {
    const db = this.database;

    const trends = convertBigIntToNumber(
      await db.aggregate("sync_sessions", [
        { $match: { instanceId, lastActivity: { $gte: timeRange.start, $lte: timeRange.end } } },
        {
          $group: {
            _id: { $dateTrunc: { date: "$lastActivity", unit: "hour" } },
            avg_latency: { $avg: "$latencyMs" },
            max_latency: { $max: "$latencyMs" },
            operation_count: { $sum: 1 },
            total_packets_received: { $sum: "$packetsReceived" },
            total_packets_sent: { $sum: "$packetsSent" },
          },
        },
        { $set: { time_bucket: "$_id" } },
        { $sort: { time_bucket: 1 } },
      ]),
    ) as any[];

    return trends.map((trend) => ({
      timestamp: trend.time_bucket,
      averageLatency: trend.avg_latency || 0,
      maxLatency: trend.max_latency || 0,
      operationCount: trend.operation_count || 0,
      packetsReceived: trend.total_packets_received || 0,
      packetsSent: trend.total_packets_sent || 0,
    }));
  }

  /**
   * Get instance reliability metrics
   */
  async getInstanceReliabilityMetrics(instanceId: string, timeRange: AnalyticsTimeRange) {
    const db = this.database;

    // Connection stability
    const connectionStability = (await db.aggregate("sync_sessions", [
      { $match: { instanceId, connectedAt: { $gte: timeRange.start, $lte: timeRange.end } } },
      {
        $group: {
          _id: null,
          total_sessions: { $sum: 1 },
          completed_sessions: { $sum: { $cond: [{ $ne: ["$disconnectedAt", null] }, 1, 0] } },
          avg_session_duration: {
            $avg: {
              $divide: [
                { $subtract: [{ $ifNull: ["$disconnectedAt", "$$NOW"] }, "$connectedAt"] },
                1000,
              ],
            },
          },
          short_sessions: {
            $sum: {
              $cond: [
                {
                  $lt: [
                    {
                      $divide: [
                        { $subtract: [{ $ifNull: ["$disconnectedAt", "$$NOW"] }, "$connectedAt"] },
                        1000,
                      ],
                    },
                    60,
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ])) as any[];

    // Sync reliability
    const syncReliability = (await db.aggregate("sync_storage_items", [
      { $match: { instanceId, lastModified: { $gte: timeRange.start, $lte: timeRange.end } } },
      {
        $group: {
          _id: null,
          total_operations: { $sum: 1 },
          successful_operations: { $sum: 1 },
          avg_version_conflicts: { $avg: "$version" },
        },
      },
    ])) as any[];

    // Error frequency
    const errorFrequency = await this.getErrorFrequency(instanceId, timeRange);

    const stability = connectionStability[0] || {};
    const reliability = syncReliability[0] || {};

    return {
      connectionStability: {
        totalSessions: stability.total_sessions || 0,
        completionRate: (stability.completed_sessions || 0) / (stability.total_sessions || 1),
        averageSessionDuration: stability.avg_session_duration || 0,
        shortSessionRate: (stability.short_sessions || 0) / (stability.total_sessions || 1),
      },
      syncReliability: {
        totalOperations: reliability.total_operations || 0,
        successRate: (reliability.successful_operations || 0) / (reliability.total_operations || 1),
        averageVersionConflicts: reliability.avg_version_conflicts || 0,
      },
      errorFrequency,
      reliabilityScore: await this.calculateReliabilityScore(instanceId, timeRange),
    };
  }

  /**
   * Get instance resource utilization
   */
  async getInstanceResourceUtilization(instanceId: string, timeRange: AnalyticsTimeRange) {
    const db = this.database;

    // Storage utilization
    const storageUtilization = (await db.aggregate("sync_storage_items", [
      { $match: { instanceId, lastModified: { $gte: timeRange.start, $lte: timeRange.end } } },
      { $match: { isDeleted: false } },
      {
        $group: {
          _id: null,
          total_items: { $sum: 1 },
          total_size_bytes: { $sum: "$size" },
          avg_item_size: { $avg: "$size" },
          max_item_size: { $max: "$size" },
        },
      },
    ])) as any[];

    // Bandwidth utilization
    const bandwidthUtilization = (await db.aggregate("sync_sessions", [
      { $match: { instanceId, connectedAt: { $gte: timeRange.start, $lte: timeRange.end } } },
      {
        $group: {
          _id: null,
          total_packets_received: { $sum: "$packetsReceived" },
          total_packets_sent: { $sum: "$packetsSent" },
          avg_latency: { $avg: "$latencyMs" },
        },
      },
    ])) as any[];

    const storage = storageUtilization[0] || {};
    const bandwidth = bandwidthUtilization[0] || {};

    return {
      storage: {
        totalItems: storage.total_items || 0,
        totalSizeBytes: storage.total_size_bytes || 0,
        averageItemSize: storage.avg_item_size || 0,
        maxItemSize: storage.max_item_size || 0,
      },
      bandwidth: {
        totalPacketsReceived: bandwidth.total_packets_received || 0,
        totalPacketsSent: bandwidth.total_packets_sent || 0,
        averageLatency: bandwidth.avg_latency || 0,
        estimatedBandwidth: this.calculateBandwidth(bandwidth),
      },
      utilizationScore: await this.calculateUtilizationScore(),
    };
  }

  /**
   * Compare multiple instances
   */
  async compareInstances(
    instanceIds: string[],
    timeRange: AnalyticsTimeRange,
    metric: "performance" | "reliability" | "utilization" | "activity" = "performance",
  ) {
    const instanceAnalytics = await Promise.all(
      instanceIds.map((id) => this.getInstanceAnalytics(id, timeRange)),
    );

    return instanceAnalytics
      .map((analytic) => ({
        instanceId: analytic.instanceId,
        userId: analytic.userId,
        value: this.getInstanceMetricValue(analytic, metric),
        deviceType: analytic.deviceInfo.type,
        rank: 0, // Will be calculated after sorting
      }))
      .sort((a, b) => b.value - a.value)
      .map((item, index) => ({ ...item, rank: index + 1 }));
  }

  /**
   * Get instance health status
   */
  async getInstanceHealthStatus(instanceId: string) {
    const db = this.database;

    const currentSession = await db.orm.sync_sessions
      .where({ instanceId })
      .orderBy({ lastActivity: -1 })
      .first();

    const recentErrors = (await db.aggregate("sync_conflicts", [
      {
        $lookup: {
          from: "sync_storage_items",
          localField: "itemId",
          foreignField: "_id",
          pipeline: [{ $match: { instanceId } }],
          as: "item",
        },
      },
      { $match: { "item.0": { $exists: true } } },
      { $match: { createdAt: { $gt: new Date(Date.now() - 3_600_000) } } },
      { $count: "error_count" },
    ])) as any[];

    const isOnline = currentSession && !currentSession.disconnectedAt;
    const lastSeen = currentSession?.lastActivity || new Date(0);
    const minutesSinceLastSeen = (Date.now() - lastSeen.getTime()) / (1000 * 60);
    const recentErrorCount = recentErrors[0]?.error_count || 0;

    let healthStatus: "healthy" | "warning" | "critical" | "offline";

    if (!isOnline && minutesSinceLastSeen > 60) {
      healthStatus = "offline";
    } else if (recentErrorCount > 10 || minutesSinceLastSeen > 30) {
      healthStatus = "critical";
    } else if (recentErrorCount > 5 || minutesSinceLastSeen > 15) {
      healthStatus = "warning";
    } else {
      healthStatus = "healthy";
    }

    return {
      status: healthStatus,
      isOnline,
      lastSeen,
      minutesSinceLastSeen,
      recentErrorCount,
      currentLatency: currentSession?.latencyMs || 0,
      healthScore: await this.calculateHealthScore(),
    };
  }

  private parseDeviceInfo(instanceInfo: any): DeviceInfo {
    let deviceData = {};

    if (instanceInfo.device && typeof instanceInfo.device === "string") {
      try {
        deviceData = JSON.parse(instanceInfo.device);
      } catch (e) {
        console.warn("Failed to parse device info:", e);
      }
    } else if (instanceInfo.device && typeof instanceInfo.device === "object") {
      deviceData = instanceInfo.device;
    }

    return {
      type: deviceData["type"] || "unknown",
      os: deviceData["os"] || "unknown",
      browser: deviceData["browser"],
      version: deviceData["version"],
      screenResolution: deviceData["screenResolution"],
      timeZone: deviceData["timeZone"] || "UTC",
    };
  }

  private async getSessionMetrics(
    instanceId: string,
    timeRange: AnalyticsTimeRange,
  ): Promise<SessionMetrics> {
    const db = this.database;

    const metrics = (await db.aggregate("sync_sessions", [
      { $match: { instanceId, connectedAt: { $gte: timeRange.start, $lte: timeRange.end } } },
      {
        $group: {
          _id: null,
          total_sessions: { $sum: 1 },
          avg_session_duration: {
            $avg: {
              $divide: [
                { $subtract: [{ $ifNull: ["$disconnectedAt", "$$NOW"] }, "$connectedAt"] },
                1000,
              ],
            },
          },
          longest_session: {
            $max: {
              $divide: [
                { $subtract: [{ $ifNull: ["$disconnectedAt", "$$NOW"] }, "$connectedAt"] },
                1000,
              ],
            },
          },
          shortest_session: {
            $min: {
              $divide: [
                { $subtract: [{ $ifNull: ["$disconnectedAt", "$$NOW"] }, "$connectedAt"] },
                1000,
              ],
            },
          },
          lastActivity: { $max: "$lastActivity" },
        },
      },
    ])) as any[];

    const currentSession = await db.orm.sync_sessions
      .where({ instanceId, disconnectedAt: null })
      .first();

    const data = metrics[0] || {};

    return {
      totalSessions: data.total_sessions || 0,
      averageSessionDuration: data.avg_session_duration || 0,
      longestSession: data.longest_session || 0,
      shortestSession: data.shortest_session || 0,
      currentSessionDuration: currentSession
        ? (Date.now() - currentSession.connectedAt.getTime()) / 1000
        : undefined,
      sessionStartTime: currentSession?.connectedAt,
      lastActivity: data.lastActivity || new Date(0),
    };
  }

  private async getSyncMetrics(
    instanceId: string,
    timeRange: AnalyticsTimeRange,
  ): Promise<SyncMetrics> {
    const db = this.database;

    const syncData = (await db.aggregate("sync_storage_items", [
      { $match: { instanceId, lastModified: { $gte: timeRange.start, $lte: timeRange.end } } },
      {
        $group: {
          _id: null,
          total_sync_operations: { $sum: 1 },
          successful_syncs: { $sum: 1 },
          failed_syncs: { $sum: 0 },
          data_transferred: { $sum: "$size" },
          avg_version: { $avg: "$version" },
        },
      },
    ])) as any[];

    const conflictData = (await db.aggregate("sync_conflicts", [
      {
        $lookup: {
          from: "sync_storage_items",
          localField: "itemId",
          foreignField: "_id",
          pipeline: [{ $match: { instanceId } }],
          as: "item",
        },
      },
      { $match: { "item.0": { $exists: true } } },
      { $match: { createdAt: { $gte: timeRange.start, $lte: timeRange.end } } },
      {
        $group: {
          _id: null,
          conflicts_generated: { $sum: 1 },
          conflicts_resolved: { $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] } },
        },
      },
    ])) as any[];

    const sync = syncData[0] || {};
    const conflicts = conflictData[0] || {};

    return {
      totalSyncOperations: sync.total_sync_operations || 0,
      successfulSyncs: sync.successful_syncs || 0,
      failedSyncs: sync.failed_syncs || 0,
      averageSyncTime: 0, // Would need additional tracking
      conflictsGenerated: conflicts.conflicts_generated || 0,
      conflictsResolved: conflicts.conflicts_resolved || 0,
      dataTransferred: sync.data_transferred || 0,
      compressionRatio: 1.0, // Would need compression tracking
    };
  }

  private async getPerformanceMetrics(
    instanceId: string,
    timeRange: AnalyticsTimeRange,
  ): Promise<PerformanceMetrics> {
    const db = this.database;

    const performance = (await db.aggregate("sync_sessions", [
      { $match: { instanceId, connectedAt: { $gte: timeRange.start, $lte: timeRange.end } } },
      {
        $group: {
          _id: null,
          average_latency: { $avg: "$latencyMs" },
          quantiles: {
            $percentile: { input: "$latencyMs", p: [0.5, 0.95, 0.99], method: "approximate" },
          },
        },
      },
      {
        $project: {
          average_latency: 1,
          p50_latency: { $arrayElemAt: ["$quantiles", 0] },
          p95_latency: { $arrayElemAt: ["$quantiles", 1] },
          p99_latency: { $arrayElemAt: ["$quantiles", 2] },
        },
      },
    ])) as any[];

    const data = performance[0] || {};

    return {
      averageLatency: data.average_latency || 0,
      p50Latency: data.p50_latency || 0,
      p95Latency: data.p95_latency || 0,
      p99Latency: data.p99_latency || 0,
      memoryUsage: 0, // Would need client-side tracking
      cpuUsage: 0, // Would need client-side tracking
      networkThroughput: 0, // Would need network monitoring
    };
  }

  private async getNetworkMetrics(
    instanceId: string,
    timeRange: AnalyticsTimeRange,
  ): Promise<NetworkMetrics> {
    const db = this.database;

    const network = convertBigIntToNumber(
      await db.aggregate("sync_sessions", [
        { $match: { instanceId, connectedAt: { $gte: timeRange.start, $lte: timeRange.end } } },
        {
          $group: {
            _id: null,
            total_packets_received: { $sum: "$packetsReceived" },
            total_packets_sent: { $sum: "$packetsSent" },
            avg_latency: { $avg: "$latencyMs" },
          },
        },
      ]),
    ) as any[];

    const data = network[0] || {};

    // Estimate bytes from packets (assuming average packet size)
    const avgPacketSize = 1024; // bytes
    const bytesReceived = (data.total_packets_received || 0) * avgPacketSize;
    const bytesSent = (data.total_packets_sent || 0) * avgPacketSize;

    return {
      packetsReceived: data.total_packets_received || 0,
      packetsSent: data.total_packets_sent || 0,
      bytesReceived,
      bytesSent,
      connectionType: "websocket", // Default connection type
      averageBandwidth: this.calculateBandwidth(data),
      packetLoss: 0, // Would need packet loss tracking
    };
  }

  private async getErrorMetrics(
    instanceId: string,
    timeRange: AnalyticsTimeRange,
  ): Promise<ErrorMetrics> {
    const db = this.database;

    const errors = (await db.aggregate("sync_conflicts", [
      {
        $lookup: {
          from: "sync_storage_items",
          localField: "itemId",
          foreignField: "_id",
          pipeline: [{ $match: { instanceId } }],
          as: "item",
        },
      },
      { $match: { "item.0": { $exists: true } } },
      { $match: { createdAt: { $gte: timeRange.start, $lte: timeRange.end } } },
      { $group: { _id: "$conflictType", total_errors: { $sum: 1 }, error_count: { $sum: 1 } } },
      { $set: { conflictType: "$_id" } },
    ])) as any[];

    const lastError = (await db.aggregate("sync_conflicts", [
      {
        $lookup: {
          from: "sync_storage_items",
          localField: "itemId",
          foreignField: "_id",
          pipeline: [{ $match: { instanceId } }],
          as: "item",
        },
      },
      { $match: { "item.0": { $exists: true } } },
      { $sort: { createdAt: -1 } },
      { $limit: 1 },
      {
        $project: { type: "$conflictType", message: "$resolutionReason", timestamp: "$createdAt" },
      },
    ])) as any[];

    const totalErrors = errors.reduce((sum, error) => sum + error.error_count, 0);
    const errorsByType = errors.reduce((acc, error) => {
      acc[error.conflictType] = error.error_count;
      return acc;
    }, {});

    return {
      totalErrors,
      errorsByType,
      errorsByEndpoint: {}, // Would need endpoint tracking
      criticalErrors: 0, // Would need severity classification
      lastError: lastError[0] || undefined,
    };
  }

  private async getUsageHistory(
    instanceId: string,
    timeRange: AnalyticsTimeRange,
  ): Promise<UsageHistoryPoint[]> {
    const db = this.database;

    const history = (await db.aggregate("sync_storage_items", [
      { $match: { instanceId, lastModified: { $gte: timeRange.start, $lte: timeRange.end } } },
      {
        $lookup: {
          from: "sync_conflicts",
          localField: "_id",
          foreignField: "itemId",
          as: "conflicts",
        },
      },
      {
        $group: {
          _id: { $dateTrunc: { date: "$lastModified", unit: "hour" } },
          operations: { $sum: 1 },
          errors: { $sum: { $size: "$conflicts" } },
          storage_usage: { $sum: "$size" },
        },
      },
      { $set: { timestamp: "$_id", response_time: null } },
      { $sort: { timestamp: 1 } },
    ])) as any[];

    return history.map((point) => ({
      timestamp: point.timestamp,
      operations: point.operations || 0,
      responseTime: point.response_time || 0,
      errors: point.errors || 0,
      storageUsage: point.storage_usage || 0,
    }));
  }

  private async getErrorFrequency(instanceId: string, timeRange: AnalyticsTimeRange) {
    const db = this.database;

    const frequency = (await db.aggregate("sync_conflicts", [
      {
        $lookup: {
          from: "sync_storage_items",
          localField: "itemId",
          foreignField: "_id",
          pipeline: [{ $match: { instanceId } }],
          as: "item",
        },
      },
      { $match: { "item.0": { $exists: true } } },
      { $match: { createdAt: { $gte: timeRange.start, $lte: timeRange.end } } },
      {
        $group: {
          _id: { $dateToString: { date: "$createdAt", format: "%Y-%m-%d" } },
          error_count: { $sum: 1 },
        },
      },
      { $set: { date: "$_id" } },
      { $sort: { date: 1 } },
    ])) as any[];

    return frequency;
  }

  private calculateBandwidth(networkData: any): number {
    // Simple bandwidth calculation based on packets and latency
    const packetsPerSecond =
      (networkData.total_packets_received + networkData.total_packets_sent) / 3600; // assuming 1-hour window
    const avgPacketSize = 1024; // bytes
    return packetsPerSecond * avgPacketSize * 8; // bits per second
  }

  private async calculateReliabilityScore(
    instanceId: string,
    timeRange: AnalyticsTimeRange,
  ): Promise<number> {
    // Implementation for reliability score calculation
    const metrics = await this.getInstanceReliabilityMetrics(instanceId, timeRange);
    let score = 100;

    // Deduct for poor connection stability
    score -= (1 - metrics.connectionStability.completionRate) * 30;
    score -= metrics.connectionStability.shortSessionRate * 20;

    // Deduct for sync issues
    score -= (1 - metrics.syncReliability.successRate) * 40;

    // Deduct for high error frequency
    const errorRate =
      metrics.errorFrequency.reduce((sum, day) => sum + day.error_count, 0) /
      metrics.errorFrequency.length;
    score -= Math.min(errorRate * 5, 10);

    return Math.max(0, Math.min(100, score));
  }

  private async calculateUtilizationScore(): Promise<number> {
    // Implementation for utilization score calculation
    return 75;
  }

  private async calculateHealthScore(): Promise<number> {
    // Implementation for health score calculation
    return 85;
  }

  private getInstanceMetricValue(analytic: InstanceAnalytics, metric: string): number {
    switch (metric) {
      case "performance":
        return analytic.performanceMetrics.averageLatency;
      case "reliability":
        return (
          analytic.syncMetrics.successfulSyncs / (analytic.syncMetrics.totalSyncOperations || 1)
        );
      case "utilization":
        return analytic.syncMetrics.dataTransferred;
      case "activity":
        return analytic.sessionMetrics.totalSessions;
      default:
        return analytic.performanceMetrics.averageLatency;
    }
  }
}
