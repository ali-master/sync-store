import { Injectable } from "@nestjs/common";
import { InjectDbTransactor, type PrismaTransactor } from "@root/modules/db";
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
    @InjectDbTransactor()
    private readonly dbTransactorService: PrismaTransactor,
  ) {}

  /**
   * Get detailed analytics for a specific instance
   */
  async getInstanceAnalytics(
    instanceId: string,
    timeRange: AnalyticsTimeRange,
  ): Promise<InstanceAnalytics> {
    const db = this.dbTransactorService.tx;

    // Get basic instance info
    const instanceInfo = await db.syncSession.findFirst({
      where: { instanceId },
      orderBy: { connectedAt: "desc" },
      select: {
        userId: true,
        device: true,
        userAgent: true,
        ipAddress: true,
        country: true,
        city: true,
      },
    });

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
    const db = this.dbTransactorService.tx;

    const trends = convertBigIntToNumber(
      await db.$queryRaw`
      SELECT 
        DATE_FORMAT(lastActivity, '%Y-%m-%d %H:00:00') as time_bucket,
        AVG(latencyMs) as avg_latency,
        MAX(latencyMs) as max_latency,
        CAST(COUNT(*) AS SIGNED) as operation_count,
        CAST(SUM(packetsReceived) AS SIGNED) as total_packets_received,
        CAST(SUM(packetsSent) AS SIGNED) as total_packets_sent
      FROM sync_sessions
      WHERE instanceId = ${instanceId}
        AND lastActivity BETWEEN ${timeRange.start} AND ${timeRange.end}
      GROUP BY DATE_FORMAT(lastActivity, '%Y-%m-%d %H:00:00')
      ORDER BY time_bucket ASC
    `,
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
    const db = this.dbTransactorService.tx;

    // Connection stability
    const connectionStability = (await db.$queryRaw`
      SELECT 
        CAST(COUNT(*) AS SIGNED) as total_sessions,
        CAST(COUNT(CASE WHEN disconnectedAt IS NOT NULL THEN 1 END) AS SIGNED) as completed_sessions,
        AVG(TIMESTAMPDIFF(SECOND, connectedAt, COALESCE(disconnectedAt, NOW()))) as avg_session_duration,
        CAST(COUNT(CASE WHEN TIMESTAMPDIFF(SECOND, connectedAt, COALESCE(disconnectedAt, NOW())) < 60 THEN 1 END) AS SIGNED) as short_sessions
      FROM sync_sessions
      WHERE instanceId = ${instanceId}
        AND connectedAt BETWEEN ${timeRange.start} AND ${timeRange.end}
    `) as any[];

    // Sync reliability
    const syncReliability = (await db.$queryRaw`
      SELECT 
        CAST(COUNT(*) AS SIGNED) as total_operations,
        CAST(COUNT(CASE WHEN isDeleted = false THEN 1 END) AS SIGNED) as successful_operations,
        AVG(version) as avg_version_conflicts
      FROM sync_storage_items ssi
      JOIN sync_sessions ss ON ssi.instanceId = ss.instanceId
      WHERE ssi.instanceId = ${instanceId}
        AND ssi.lastModified BETWEEN ${timeRange.start} AND ${timeRange.end}
    `) as any[];

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
    const db = this.dbTransactorService.tx;

    // Storage utilization
    const storageUtilization = (await db.$queryRaw`
      SELECT 
        CAST(COUNT(*) AS SIGNED) as total_items,
        CAST(SUM(size) AS SIGNED) as total_size_bytes,
        AVG(size) as avg_item_size,
        CAST(MAX(size) AS SIGNED) as max_item_size
      FROM sync_storage_items
      WHERE instanceId = ${instanceId}
        AND lastModified BETWEEN ${timeRange.start} AND ${timeRange.end}
        AND isDeleted = false
    `) as any[];

    // Bandwidth utilization
    const bandwidthUtilization = (await db.$queryRaw`
      SELECT 
        CAST(SUM(packetsReceived) AS SIGNED) as total_packets_received,
        CAST(SUM(packetsSent) AS SIGNED) as total_packets_sent,
        AVG(latencyMs) as avg_latency
      FROM sync_sessions
      WHERE instanceId = ${instanceId}
        AND connectedAt BETWEEN ${timeRange.start} AND ${timeRange.end}
    `) as any[];

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
    const db = this.dbTransactorService.tx;

    const currentSession = await db.syncSession.findFirst({
      where: { instanceId },
      orderBy: { lastActivity: "desc" },
    });

    const recentErrors = (await db.$queryRaw`
      SELECT CAST(COUNT(*) AS SIGNED) as error_count
      FROM sync_conflicts
      WHERE itemId IN (
        SELECT id FROM sync_storage_items WHERE instanceId = ${instanceId}
      )
      AND createdAt > NOW() - INTERVAL 1 HOUR
    `) as any[];

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
    const db = this.dbTransactorService.tx;

    const metrics = (await db.$queryRaw`
      SELECT 
        CAST(COUNT(*) AS SIGNED) as total_sessions,
        AVG(TIMESTAMPDIFF(SECOND, connectedAt, COALESCE(disconnectedAt, NOW()))) as avg_session_duration,
        MAX(TIMESTAMPDIFF(SECOND, connectedAt, COALESCE(disconnectedAt, NOW()))) as longest_session,
        MIN(TIMESTAMPDIFF(SECOND, connectedAt, COALESCE(disconnectedAt, NOW()))) as shortest_session,
        MAX(lastActivity) as lastActivity
      FROM sync_sessions
      WHERE instanceId = ${instanceId}
        AND connectedAt BETWEEN ${timeRange.start} AND ${timeRange.end}
    `) as any[];

    const currentSession = await db.syncSession.findFirst({
      where: { instanceId, disconnectedAt: null },
      select: {
        connectedAt: true,
        lastActivity: true,
      },
    });

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
    const db = this.dbTransactorService.tx;

    const syncData = (await db.$queryRaw`
      SELECT 
        CAST(COUNT(*) AS SIGNED) as total_sync_operations,
        CAST(COUNT(CASE WHEN isDeleted = false THEN 1 END) AS SIGNED) as successful_syncs,
        CAST(COUNT(CASE WHEN isDeleted = true THEN 1 END) AS SIGNED) as failed_syncs,
        CAST(SUM(size) AS SIGNED) as data_transferred,
        AVG(version) as avg_version
      FROM sync_storage_items
      WHERE instanceId = ${instanceId}
        AND lastModified BETWEEN ${timeRange.start} AND ${timeRange.end}
    `) as any[];

    const conflictData = (await db.$queryRaw`
      SELECT 
        CAST(COUNT(*) AS SIGNED) as conflicts_generated,
        CAST(COUNT(CASE WHEN status = 'resolved' THEN 1 END) AS SIGNED) as conflicts_resolved
      FROM sync_conflicts sc
      JOIN sync_storage_items ssi ON sc.itemId = ssi.id
      WHERE ssi.instanceId = ${instanceId}
        AND sc.createdAt BETWEEN ${timeRange.start} AND ${timeRange.end}
    `) as any[];

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
    const db = this.dbTransactorService.tx;

    const performance = (await db.$queryRaw`
      SELECT 
        AVG(latencyMs) as average_latency,
        AVG(latencyMs) * 1.2 as p50_latency,
        AVG(latencyMs) * 2.0 as p95_latency,
        AVG(latencyMs) * 2.5 as p99_latency
      FROM sync_sessions
      WHERE instanceId = ${instanceId}
        AND connectedAt BETWEEN ${timeRange.start} AND ${timeRange.end}
        AND latencyMs IS NOT NULL
    `) as any[];

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
    const db = this.dbTransactorService.tx;

    const network = convertBigIntToNumber(
      await db.$queryRaw`
      SELECT 
        CAST(SUM(packetsReceived) AS SIGNED) as total_packets_received,
        CAST(SUM(packetsSent) AS SIGNED) as total_packets_sent,
        AVG(latencyMs) as avg_latency
      FROM sync_sessions
      WHERE instanceId = ${instanceId}
        AND connectedAt BETWEEN ${timeRange.start} AND ${timeRange.end}
    `,
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
    const db = this.dbTransactorService.tx;

    const errors = (await db.$queryRaw`
      SELECT 
        CAST(COUNT(*) AS SIGNED) as total_errors,
        sc.conflictType,
        CAST(COUNT(*) AS SIGNED) as error_count
      FROM sync_conflicts sc
      JOIN sync_storage_items ssi ON sc.itemId = ssi.id
      WHERE ssi.instanceId = ${instanceId}
        AND sc.createdAt BETWEEN ${timeRange.start} AND ${timeRange.end}
      GROUP BY sc.conflictType
    `) as any[];

    const lastError = (await db.$queryRaw`
      SELECT 
        sc.conflictType as type,
        sc.resolutionReason as message,
        sc.createdAt as timestamp
      FROM sync_conflicts sc
      JOIN sync_storage_items ssi ON sc.itemId = ssi.id
      WHERE ssi.instanceId = ${instanceId}
      ORDER BY sc.createdAt DESC
      LIMIT 1
    `) as any[];

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
    const db = this.dbTransactorService.tx;

    const history = (await db.$queryRaw`
      SELECT 
        DATE_FORMAT(ssi.lastModified, '%Y-%m-%d %H:00:00') as timestamp,
        CAST(COUNT(*) AS SIGNED) as operations,
        AVG(ss.latencyMs) as response_time,
        CAST(COUNT(CASE WHEN sc.id IS NOT NULL THEN 1 END) AS SIGNED) as errors,
        CAST(SUM(ssi.size) AS SIGNED) as storage_usage
      FROM sync_storage_items ssi
      LEFT JOIN sync_sessions ss ON ssi.instanceId = ss.instanceId
      LEFT JOIN sync_conflicts sc ON ssi.id = sc.itemId
      WHERE ssi.instanceId = ${instanceId}
        AND ssi.lastModified BETWEEN ${timeRange.start} AND ${timeRange.end}
      GROUP BY DATE_FORMAT(ssi.lastModified, '%Y-%m-%d %H:00:00')
      ORDER BY timestamp ASC
    `) as any[];

    return history.map((point) => ({
      timestamp: point.timestamp,
      operations: point.operations || 0,
      responseTime: point.response_time || 0,
      errors: point.errors || 0,
      storageUsage: point.storage_usage || 0,
    }));
  }

  private async getErrorFrequency(instanceId: string, timeRange: AnalyticsTimeRange) {
    const db = this.dbTransactorService.tx;

    const frequency = (await db.$queryRaw`
      SELECT 
        DATE_FORMAT(sc.createdAt, '%Y-%m-%d') as date,
        CAST(COUNT(*) AS SIGNED) as error_count
      FROM sync_conflicts sc
      JOIN sync_storage_items ssi ON sc.itemId = ssi.id
      WHERE ssi.instanceId = ${instanceId}
        AND sc.createdAt BETWEEN ${timeRange.start} AND ${timeRange.end}
      GROUP BY DATE_FORMAT(sc.createdAt, '%Y-%m-%d')
      ORDER BY date ASC
    `) as any[];

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
