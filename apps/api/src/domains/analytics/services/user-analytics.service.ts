import { Injectable } from "@nestjs/common";
import { InjectDatabase, type Database } from "@root/modules/db";
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
    @InjectDatabase()
    private readonly database: Database,
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
    const db = this.database;

    // Daily active sessions
    const dailyActiveSessions = (await db.aggregate("sync_sessions", [
      { $match: { userId, connectedAt: { $gte: timeRange.start, $lte: timeRange.end } } },
      {
        $group: {
          _id: { $dateTrunc: { date: "$connectedAt", unit: "day" } },
          session_count: { $sum: 1 },
          avg_session_duration: {
            $avg: {
              $divide: [
                { $subtract: [{ $ifNull: ["$disconnectedAt", "$$NOW"] }, "$connectedAt"] },
                1000,
              ],
            },
          },
        },
      },
      { $project: { _id: 0, date: "$_id", session_count: 1, avg_session_duration: 1 } },
      { $sort: { date: 1 } },
    ])) as any[];

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
    const db = this.database;

    // Peak usage times
    const peakUsageTimes = (await db.aggregate("sync_storage_items", [
      { $match: { userId, lastModified: { $gte: timeRange.start, $lte: timeRange.end } } },
      {
        $group: {
          _id: { hour: { $hour: "$lastModified" }, day: { $dayOfWeek: "$lastModified" } },
          operation_count: { $sum: 1 },
        },
      },
      { $project: { hour: "$_id.hour", day_of_week: "$_id.day", operation_count: 1 } },
      { $sort: { operation_count: -1 } },
    ])) as any[];

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
    const db = this.database;

    // Get users grouped by their signup month (cohorts)
    const cohorts = (await db.aggregate("sync_sessions", [
      { $match: { connectedAt: { $gte: timeRange.start, $lte: timeRange.end } } },
      {
        $group: {
          _id: { $dateToString: { date: "$connectedAt", format: "%Y-%m" } },
          users: { $addToSet: "$userId" },
          cohort_start_date: { $min: "$connectedAt" },
        },
      },
      {
        $project: { cohort_month: "$_id", cohort_size: { $size: "$users" }, cohort_start_date: 1 },
      },
      { $sort: { cohort_month: 1 } },
    ])) as any[];

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
          await db.aggregate("sync_sessions", [
            {
              $match: {
                $expr: {
                  $eq: [
                    { $dateToString: { date: "$connectedAt", format: "%Y-%m" } },
                    cohort.cohort_month,
                  ],
                },
              },
            },
            { $group: { _id: "$userId" } },
            {
              $lookup: {
                from: "sync_sessions",
                localField: "_id",
                foreignField: "userId",
                pipeline: [
                  { $match: { connectedAt: { $gte: oneMonthLater, $lte: oneMonthEnd } } },
                  { $limit: 1 },
                ],
                as: "retained",
              },
            },
            { $match: { "retained.0": { $exists: true } } },
            { $count: "retained_users" },
          ]),
        ) as any[];

        // Calculate 3-month retention
        const threeMonthEnd = new Date(threeMonthsLater);
        threeMonthEnd.setMonth(threeMonthEnd.getMonth() + 1);

        const month3Retained = convertBigIntToNumber(
          await db.aggregate("sync_sessions", [
            {
              $match: {
                $expr: {
                  $eq: [
                    { $dateToString: { date: "$connectedAt", format: "%Y-%m" } },
                    cohort.cohort_month,
                  ],
                },
              },
            },
            { $group: { _id: "$userId" } },
            {
              $lookup: {
                from: "sync_sessions",
                localField: "_id",
                foreignField: "userId",
                pipeline: [
                  { $match: { connectedAt: { $gte: threeMonthsLater, $lte: threeMonthEnd } } },
                  { $limit: 1 },
                ],
                as: "retained",
              },
            },
            { $match: { "retained.0": { $exists: true } } },
            { $count: "retained_users" },
          ]),
        ) as any[];

        // Calculate current retention (users still active in the last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const currentRetained = (await db.aggregate("sync_sessions", [
          {
            $match: {
              $expr: {
                $eq: [
                  { $dateToString: { date: "$connectedAt", format: "%Y-%m" } },
                  cohort.cohort_month,
                ],
              },
            },
          },
          { $group: { _id: "$userId" } },
          {
            $lookup: {
              from: "sync_sessions",
              localField: "_id",
              foreignField: "userId",
              pipeline: [{ $match: { lastActivity: { $gte: thirtyDaysAgo } } }, { $limit: 1 }],
              as: "retained",
            },
          },
          { $match: { "retained.0": { $exists: true } } },
          { $count: "retained_users" },
        ])) as any[];

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

    const churnAnalysis = (await db.aggregate("sync_sessions", [
      { $match: { connectedAt: { $gte: timeRange.start, $lte: timeRange.end } } },
      { $group: { _id: "$userId" } },
      {
        $lookup: {
          from: "sync_sessions",
          localField: "_id",
          foreignField: "userId",
          pipeline: [{ $match: { lastActivity: { $gte: thirtyDaysAgo } } }, { $limit: 1 }],
          as: "active",
        },
      },
      {
        $group: {
          _id: null,
          total_users: { $sum: 1 },
          active_users: { $sum: { $cond: [{ $gt: [{ $size: "$active" }, 0] }, 1, 0] } },
        },
      },
    ])) as any[];

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
    const db = this.database;

    const result = (await db.aggregate("sync_storage_items", [
      { $match: { userId, lastModified: { $gte: timeRange.start, $lte: timeRange.end } } },
      {
        $group: {
          _id: null,
          total_operations: { $sum: 1 },
          active_items: { $sum: { $cond: ["$isDeleted", 0, 1] } },
          avg_item_size: { $avg: "$size" },
          last_activity: { $max: "$lastModified" },
        },
      },
    ])) as any[];

    return result[0] || { total_operations: 0, active_items: 0, avg_item_size: 0 };
  }

  private async getStorageUsage(userId: string): Promise<StorageUsage> {
    const db = this.database;

    const storageData = (await db.aggregate("sync_storage_items", [
      { $match: { userId, isDeleted: false } },
      {
        $group: {
          _id: null,
          total_items: { $sum: 1 },
          total_size_bytes: { $sum: "$size" },
          average_item_size: { $avg: "$size" },
          max_item_size: { $max: "$size" },
          oldest_item_date: { $min: "$lastModified" },
        },
      },
    ])) as any[];

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
    const db = this.database;

    const results = (await db.aggregate("sync_sessions", [
      { $match: { userId, connectedAt: { $gte: timeRange.start, $lte: timeRange.end } } },
      {
        $group: {
          _id: "$device",
          count: { $sum: 1 },
          average_session_duration: {
            $avg: {
              $divide: [
                { $subtract: [{ $ifNull: ["$disconnectedAt", "$$NOW"] }, "$connectedAt"] },
                1000,
              ],
            },
          },
        },
      },
      { $project: { device_type: "$_id", count: 1, average_session_duration: 1 } },
    ])) as any[];

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
    const db = this.database;

    const results = (await db.aggregate("sync_storage_items", [
      { $match: { userId, lastModified: { $gte: timeRange.start, $lte: timeRange.end } } },
      {
        $group: {
          _id: { hour: { $hour: "$lastModified" }, day: { $dayOfWeek: "$lastModified" } },
          operation_count: { $sum: 1 },
        },
      },
      {
        $project: {
          hour: "$_id.hour",
          day_of_week: "$_id.day",
          operation_count: 1,
          average_response_time: { $literal: null },
        },
      },
      { $sort: { operation_count: -1 } },
    ])) as any[];

    return results.map((item) => ({
      hour: item.hour,
      dayOfWeek: item.day_of_week,
      operationCount: item.operation_count,
      averageResponseTime: item.average_response_time || 0,
    }));
  }

  private async getConflictRate(userId: string, timeRange: AnalyticsTimeRange): Promise<number> {
    const db = this.database;

    const result = (await db.aggregate("sync_storage_items", [
      { $match: { userId, lastModified: { $gte: timeRange.start, $lte: timeRange.end } } },
      {
        $lookup: {
          from: "sync_conflicts",
          localField: "_id",
          foreignField: "itemId",
          as: "conflicts",
        },
      },
      { $group: { _id: null, total: { $sum: 1 }, conflicts: { $sum: { $size: "$conflicts" } } } },
      { $project: { conflict_rate: { $divide: ["$conflicts", "$total"] } } },
    ])) as any[];

    return result[0]?.conflict_rate || 0;
  }

  private async getSessionMetrics(userId: string, timeRange: AnalyticsTimeRange) {
    const db = this.database;

    const result = (await db.aggregate("sync_sessions", [
      { $match: { userId, connectedAt: { $gte: timeRange.start, $lte: timeRange.end } } },
      {
        $group: {
          _id: null,
          total_sessions: { $sum: 1 },
          average_session_duration: {
            $avg: {
              $divide: [
                { $subtract: [{ $ifNull: ["$disconnectedAt", "$$NOW"] }, "$connectedAt"] },
                1000,
              ],
            },
          },
        },
      },
    ])) as any[];

    return result[0] || { total_sessions: 0, average_session_duration: 0 };
  }

  private async getMostActiveHours(
    userId: string,
    timeRange: AnalyticsTimeRange,
  ): Promise<number[]> {
    const db = this.database;

    const results = (await db.aggregate("sync_storage_items", [
      { $match: { userId, lastModified: { $gte: timeRange.start, $lte: timeRange.end } } },
      { $group: { _id: { $hour: "$lastModified" }, operation_count: { $sum: 1 } } },
      { $project: { hour: "$_id", operation_count: 1 } },
      { $sort: { operation_count: -1 } },
      { $limit: 5 },
    ])) as any[];

    return results.map((item) => item.hour);
  }

  private async getSyncFrequency(
    userId: string,
    timeRange: AnalyticsTimeRange,
  ): Promise<SyncFrequency> {
    const db = this.database;

    const daily = (await db.aggregate("sync_storage_items", [
      { $match: { userId, lastModified: { $gte: timeRange.start, $lte: timeRange.end } } },
      { $group: { _id: { $dateTrunc: { date: "$lastModified", unit: "day" } } } },
      { $count: "days" },
    ])) as any[];

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
    const db = this.database;

    const syncOperations = (await db.aggregate("sync_storage_items", [
      { $match: { userId, lastModified: { $gte: timeRange.start, $lte: timeRange.end } } },
      { $group: { _id: null, count: { $sum: 1 }, last_used: { $max: "$lastModified" } } },
    ])) as any[];

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
