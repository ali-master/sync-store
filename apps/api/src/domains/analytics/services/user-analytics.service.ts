import { Injectable } from "@nestjs/common";
import { InjectDbTransactor, type PrismaTransactor } from "@root/modules/db";
import { convertBigIntToNumber } from "@root/utils/bigint-converter.util";

import {
  UserAnalytics,
  AnalyticsTimeRange,
  StorageUsage,
  DeviceTypeUsage,
  ActivityPattern,
  SyncFrequency,
  FeatureUsage,
} from "../types/analytics.types";

@Injectable()
export class UserAnalyticsService {
  constructor(
    @InjectDbTransactor()
    private readonly dbTransactorService: PrismaTransactor,
  ) {}

  /**
   * Get detailed analytics for a specific user
   */
  async getUserAnalytics(userId: string, timeRange: AnalyticsTimeRange): Promise<UserAnalytics> {
    // Get basic user metrics
    const userMetrics = await this.getUserMetrics(userId, timeRange);

    // Get storage usage
    const storageUsage = await this.getStorageUsage(userId);

    // Get device types
    const deviceTypes = await this.getDeviceTypeUsage(userId, timeRange);

    // Get activity patterns
    const activityPatterns = await this.getActivityPatterns(userId, timeRange);

    // Get conflict rate
    const conflictRate = await this.getConflictRate(userId, timeRange);

    // Get session metrics
    const sessionMetrics = await this.getSessionMetrics(userId, timeRange);

    // Get most active hours
    const mostActiveHours = await this.getMostActiveHours(userId, timeRange);

    // Get sync frequency
    const syncFrequency = await this.getSyncFrequency(userId, timeRange);

    // Get feature usage
    const featureUsage = await this.getFeatureUsage(userId, timeRange);

    const result = {
      userId,
      totalSessions: sessionMetrics.totalSessions,
      totalOperations: userMetrics.totalOperations,
      storageUsage,
      deviceTypes,
      activityPatterns,
      conflictRate,
      averageSessionDuration: sessionMetrics.averageSessionDuration,
      mostActiveHours,
      syncFrequency,
      featureUsage,
    };

    return convertBigIntToNumber(result);
  }

  /**
   * Get user engagement metrics
   */
  async getUserEngagementMetrics(userId: string, timeRange: AnalyticsTimeRange) {
    const db = this.dbTransactorService.tx;

    // Daily active sessions
    const dailyActiveSessions = (await db.$queryRaw`
      SELECT 
        DATE(connectedAt) as date,
        CAST(COUNT(*) AS SIGNED) as session_count,
        AVG(TIMESTAMPDIFF(SECOND, connectedAt, COALESCE(disconnectedAt, NOW()))) as avg_session_duration
      FROM sync_sessions
      WHERE userId = ${userId}
        AND connectedAt BETWEEN ${timeRange.start} AND ${timeRange.end}
      GROUP BY DATE(connectedAt)
      ORDER BY date ASC
    `) as any[];

    return {
      dailyActiveSessions,
      featureAdoption: [],
      retentionMetrics: { dayOneRetention: 0, daySevenRetention: 0, dayThirtyRetention: 0 },
      usageIntensity: { light: 0, moderate: 0, heavy: 0, power: 0 },
      engagementScore: 0,
    };
  }

  /**
   * Get user behavior patterns
   */
  async getUserBehaviorPatterns(userId: string, timeRange: AnalyticsTimeRange) {
    const db = this.dbTransactorService.tx;

    // Peak usage times
    const peakUsageTimes = (await db.$queryRaw`
      SELECT 
        HOUR(lastModified) as hour,
        DAYOFWEEK(lastModified) as day_of_week,
        CAST(COUNT(*) AS SIGNED) as operation_count
      FROM sync_storage_items
      WHERE userId = ${userId}
        AND lastModified BETWEEN ${timeRange.start} AND ${timeRange.end}
      GROUP BY HOUR(lastModified), DAYOFWEEK(lastModified)
      ORDER BY operation_count DESC
    `) as any[];

    return {
      peakUsageTimes,
      dataAccessPatterns: [],
      syncPatterns: { temporalPatterns: [], batchPatterns: [] },
      errorPatterns: { typePatterns: [], contextPatterns: [] },
      behaviorScore: 0,
    };
  }

  /**
   * Compare multiple users
   */
  async compareUsers(
    userIds: string[],
    timeRange: AnalyticsTimeRange,
    metric: "operations" | "storage" | "sessions" | "conflicts" = "operations",
  ) {
    const userAnalytics = await Promise.all(
      userIds.map((id) => this.getUserAnalytics(id, timeRange)),
    );

    return userAnalytics
      .map((analytic) => ({
        userId: analytic.userId,
        value: this.getUserMetricValue(analytic, metric),
        rank: 0, // Will be calculated after sorting
      }))
      .sort((a, b) => b.value - a.value)
      .map((item, index) => ({ ...item, rank: index + 1 }));
  }

  /**
   * Get user cohort analysis
   */
  async getUserCohortAnalysis(timeRange: AnalyticsTimeRange) {
    const db = this.dbTransactorService.tx;

    // Get users grouped by their signup month (cohorts)
    const cohorts = (await db.$queryRaw`
      SELECT
        DATE_FORMAT(ss.connectedAt, '%Y-%m') as cohort_month,
        CAST(COUNT(DISTINCT ss.userId) AS SIGNED) as cohort_size,
        MIN(ss.connectedAt) as cohort_start_date
      FROM sync_sessions ss
      WHERE ss.connectedAt BETWEEN ${timeRange.start} AND ${timeRange.end}
      GROUP BY DATE_FORMAT(ss.connectedAt, '%Y-%m')
      ORDER BY cohort_month ASC
    `) as any[];

    // Calculate retention rates for each cohort
    const retentionRates = await Promise.all(
      cohorts.map(async (cohort) => {
        const cohortStartDate = new Date(cohort.cohort_start_date);
        const oneMonthLater = new Date(cohortStartDate);
        oneMonthLater.setMonth(oneMonthLater.getMonth() + 1);
        const threeMonthsLater = new Date(cohortStartDate);
        threeMonthsLater.setMonth(threeMonthsLater.getMonth() + 3);

        // Skip if cohort is empty
        if (cohort.cohort_size === 0) {
          return {
            cohort: cohort.cohort_month,
            cohortSize: cohort.cohort_size,
            month1Retention: 0,
            month3Retention: 0,
            currentRetention: 0,
          };
        }

        // Calculate 1-month retention using a safer approach
        const oneMonthEnd = new Date(oneMonthLater);
        oneMonthEnd.setMonth(oneMonthEnd.getMonth() + 1);

        const month1Retained = convertBigIntToNumber(
          await db.$queryRaw`
          SELECT CAST(COUNT(DISTINCT ss2.userId) AS SIGNED) as retained_users
          FROM sync_sessions ss1
          JOIN sync_sessions ss2 ON ss1.userId = ss2.userId
          WHERE DATE_FORMAT(ss1.connectedAt, '%Y-%m') = ${cohort.cohort_month}
            AND ss2.connectedAt BETWEEN ${oneMonthLater} AND ${oneMonthEnd}
        `,
        ) as any[];

        // Calculate 3-month retention
        const threeMonthEnd = new Date(threeMonthsLater);
        threeMonthEnd.setMonth(threeMonthEnd.getMonth() + 1);

        const month3Retained = convertBigIntToNumber(
          await db.$queryRaw`
          SELECT CAST(COUNT(DISTINCT ss2.userId) AS SIGNED) as retained_users
          FROM sync_sessions ss1
          JOIN sync_sessions ss2 ON ss1.userId = ss2.userId
          WHERE DATE_FORMAT(ss1.connectedAt, '%Y-%m') = ${cohort.cohort_month}
            AND ss2.connectedAt BETWEEN ${threeMonthsLater} AND ${threeMonthEnd}
        `,
        ) as any[];

        // Calculate current retention (users still active in the last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const currentRetained = (await db.$queryRaw`
          SELECT CAST(COUNT(DISTINCT ss2.userId) AS SIGNED) as retained_users
          FROM sync_sessions ss1
          JOIN sync_sessions ss2 ON ss1.userId = ss2.userId
          WHERE DATE_FORMAT(ss1.connectedAt, '%Y-%m') = ${cohort.cohort_month}
            AND ss2.lastActivity >= ${thirtyDaysAgo}
        `) as any[];

        const cohortSizeNumber = convertBigIntToNumber(cohort.cohort_size);
        return {
          cohort: cohort.cohort_month,
          cohortSize: cohortSizeNumber,
          month1Retention:
            (convertBigIntToNumber(month1Retained[0]?.retained_users) || 0) / cohortSizeNumber,
          month3Retention:
            (convertBigIntToNumber(month3Retained[0]?.retained_users) || 0) / cohortSizeNumber,
          currentRetention:
            (convertBigIntToNumber(currentRetained[0]?.retained_users) || 0) / cohortSizeNumber,
        };
      }),
    );

    // Calculate insights
    const validRetentionRates = retentionRates.filter((r) => r.cohortSize > 0);
    const averageRetention =
      validRetentionRates.length > 0
        ? validRetentionRates.reduce((sum, r) => sum + r.currentRetention, 0) /
          validRetentionRates.length
        : 0;

    const bestPerformingCohort = validRetentionRates.reduce(
      (best, current) => (current.currentRetention > best.currentRetention ? current : best),
      { cohort: "", currentRetention: 0 },
    );

    // Calculate overall churn rate (users who haven't been active in 30+ days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const churnAnalysis = (await db.$queryRaw`
      SELECT 
        CAST(COUNT(DISTINCT total_users.userId) AS SIGNED) as total_users,
        CAST(COUNT(DISTINCT active_users.userId) AS SIGNED) as active_users
      FROM (
        SELECT DISTINCT userId
        FROM sync_sessions
        WHERE connectedAt BETWEEN ${timeRange.start} AND ${timeRange.end}
      ) total_users
      LEFT JOIN (
        SELECT DISTINCT userId
        FROM sync_sessions
        WHERE lastActivity >= ${thirtyDaysAgo}
      ) active_users ON total_users.userId = active_users.userId
    `) as any[];

    const totalUsers = convertBigIntToNumber(churnAnalysis[0]?.total_users) || 0;
    const activeUsers = convertBigIntToNumber(churnAnalysis[0]?.active_users) || 0;
    const churnRate = totalUsers > 0 ? (totalUsers - activeUsers) / totalUsers : 0;

    const result = {
      cohorts: cohorts.map((c) => ({
        month: c.cohort_month,
        size: c.cohort_size,
        startDate: c.cohort_start_date,
      })),
      retentionRates,
      insights: {
        bestPerformingCohort: bestPerformingCohort.cohort,
        averageRetention,
        churnRate,
      },
    };

    return convertBigIntToNumber(result);
  }

  private async getUserMetrics(userId: string, timeRange: AnalyticsTimeRange) {
    const db = this.dbTransactorService.tx;

    const result = (await db.$queryRaw`
      SELECT 
        CAST(COUNT(*) AS SIGNED) as total_operations,
        CAST(COUNT(CASE WHEN isDeleted = false THEN 1 END) AS SIGNED) as active_items,
        AVG(size) as avg_item_size,
        MAX(lastModified) as last_activity
      FROM sync_storage_items
      WHERE userId = ${userId}
        AND lastModified BETWEEN ${timeRange.start} AND ${timeRange.end}
    `) as any[];

    return result[0] || { total_operations: 0, active_items: 0, avg_item_size: 0 };
  }

  private async getStorageUsage(userId: string): Promise<StorageUsage> {
    const db = this.dbTransactorService.tx;

    const storageData = (await db.$queryRaw`
      SELECT 
        CAST(COUNT(*) AS SIGNED) as total_items,
        CAST(SUM(size) AS SIGNED) as total_size_bytes,
        AVG(size) as average_item_size,
        CAST(MAX(size) AS SIGNED) as max_item_size,
        MIN(lastModified) as oldest_item_date
      FROM sync_storage_items
      WHERE userId = ${userId} AND isDeleted = false
    `) as any[];

    const data = storageData[0] || {};

    return {
      totalItems: data.total_items || 0,
      totalSizeBytes: data.total_size_bytes || 0,
      averageItemSize: data.average_item_size || 0,
      largestItem: { key: "", sizeBytes: 0 },
      oldestItem: { key: "", age: 0 },
      mostAccessedItems: [],
    };
  }

  private async getDeviceTypeUsage(
    userId: string,
    timeRange: AnalyticsTimeRange,
  ): Promise<DeviceTypeUsage[]> {
    const db = this.dbTransactorService.tx;

    const results = (await db.$queryRaw`
      SELECT 
        COALESCE(JSON_UNQUOTE(JSON_EXTRACT(device, '$.type')), 'unknown') as device_type,
        CAST(COUNT(*) AS SIGNED) as count,
        AVG(TIMESTAMPDIFF(SECOND, connectedAt, COALESCE(disconnectedAt, NOW()))) as average_session_duration
      FROM sync_sessions
      WHERE userId = ${userId}
        AND connectedAt BETWEEN ${timeRange.start} AND ${timeRange.end}
      GROUP BY device_type
    `) as any[];

    const totalSessions = results.reduce((sum, item) => sum + Number(item.count), 0);

    return results.map((item) => ({
      deviceType: item.device_type || "unknown",
      count: Number(item.count),
      percentage: totalSessions > 0 ? (Number(item.count) / totalSessions) * 100 : 0,
      averageSessionDuration: item.average_session_duration || 0,
    }));
  }

  private async getActivityPatterns(
    userId: string,
    timeRange: AnalyticsTimeRange,
  ): Promise<ActivityPattern[]> {
    const db = this.dbTransactorService.tx;

    const results = (await db.$queryRaw`
      SELECT 
        HOUR(lastModified) as hour,
        DAYOFWEEK(lastModified) as day_of_week,
        CAST(COUNT(*) AS SIGNED) as operation_count,
        AVG(size) as average_response_time
      FROM sync_storage_items
      WHERE userId = ${userId}
        AND lastModified BETWEEN ${timeRange.start} AND ${timeRange.end}
      GROUP BY HOUR(lastModified), DAYOFWEEK(lastModified)
      ORDER BY operation_count DESC
    `) as any[];

    return results.map((item) => ({
      hour: item.hour,
      dayOfWeek: item.day_of_week,
      operationCount: item.operation_count,
      averageResponseTime: item.average_response_time || 0,
    }));
  }

  private async getConflictRate(userId: string, timeRange: AnalyticsTimeRange): Promise<number> {
    const db = this.dbTransactorService.tx;

    const result = (await db.$queryRaw`
      SELECT 
        (CAST(COUNT(DISTINCT sc.id) AS DECIMAL) / NULLIF(CAST(COUNT(DISTINCT ssi.id) AS DECIMAL), 0)) as conflict_rate
      FROM sync_storage_items ssi
      LEFT JOIN sync_conflicts sc ON ssi.id = sc.itemId
      WHERE ssi.userId = ${userId}
        AND ssi.lastModified BETWEEN ${timeRange.start} AND ${timeRange.end}
    `) as any[];

    return result[0]?.conflict_rate || 0;
  }

  private async getSessionMetrics(userId: string, timeRange: AnalyticsTimeRange) {
    const db = this.dbTransactorService.tx;

    const result = (await db.$queryRaw`
      SELECT 
        CAST(COUNT(*) AS SIGNED) as total_sessions,
        AVG(TIMESTAMPDIFF(SECOND, connectedAt, COALESCE(disconnectedAt, NOW()))) as average_session_duration
      FROM sync_sessions
      WHERE userId = ${userId}
        AND connectedAt BETWEEN ${timeRange.start} AND ${timeRange.end}
    `) as any[];

    return result[0] || { total_sessions: 0, average_session_duration: 0 };
  }

  private async getMostActiveHours(
    userId: string,
    timeRange: AnalyticsTimeRange,
  ): Promise<number[]> {
    const db = this.dbTransactorService.tx;

    const results = (await db.$queryRaw`
      SELECT 
        HOUR(lastModified) as hour,
        CAST(COUNT(*) AS SIGNED) as operation_count
      FROM sync_storage_items
      WHERE userId = ${userId}
        AND lastModified BETWEEN ${timeRange.start} AND ${timeRange.end}
      GROUP BY HOUR(lastModified)
      ORDER BY operation_count DESC
      LIMIT 5
    `) as any[];

    return results.map((item) => item.hour);
  }

  private async getSyncFrequency(
    userId: string,
    timeRange: AnalyticsTimeRange,
  ): Promise<SyncFrequency> {
    const db = this.dbTransactorService.tx;

    const daily = (await db.$queryRaw`
      SELECT CAST(COUNT(DISTINCT DATE(lastModified)) AS SIGNED) as days
      FROM sync_storage_items
      WHERE userId = ${userId}
        AND lastModified BETWEEN ${timeRange.start} AND ${timeRange.end}
    `) as any[];

    const totalDays = Math.ceil(
      (timeRange.end.getTime() - timeRange.start.getTime()) / (1000 * 60 * 60 * 24),
    );

    const daysCount = convertBigIntToNumber(daily[0]?.days) || 0;

    return {
      daily: daysCount / Math.max(totalDays, 1),
      weekly: daysCount / Math.max(Math.ceil(totalDays / 7), 1),
      monthly: daysCount / Math.max(Math.ceil(totalDays / 30), 1),
      averageInterval: Math.max(totalDays, 1) / Math.max(daysCount || 1, 1),
    };
  }

  private async getFeatureUsage(
    userId: string,
    timeRange: AnalyticsTimeRange,
  ): Promise<FeatureUsage[]> {
    const db = this.dbTransactorService.tx;

    const syncOperations = (await db.$queryRaw`
      SELECT CAST(COUNT(*) AS SIGNED) as count, MAX(lastModified) as last_used
      FROM sync_storage_items
      WHERE userId = ${userId}
        AND lastModified BETWEEN ${timeRange.start} AND ${timeRange.end}
    `) as any[];

    return [
      {
        featureName: "sync_operations",
        usageCount: syncOperations[0]?.count || 0,
        lastUsed: syncOperations[0]?.last_used || timeRange.start,
        successRate: 0.95,
      },
    ];
  }

  private getUserMetricValue(analytic: UserAnalytics, metric: string): number {
    switch (metric) {
      case "operations":
        return analytic.totalOperations;
      case "storage":
        return analytic.storageUsage.totalSizeBytes;
      case "sessions":
        return analytic.totalSessions;
      case "conflicts":
        return analytic.conflictRate;
      default:
        return analytic.totalOperations;
    }
  }
}
