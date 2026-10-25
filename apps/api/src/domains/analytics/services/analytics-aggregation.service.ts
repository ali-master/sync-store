import { Injectable, Logger } from "@nestjs/common";
import { InjectDatabase, type Database } from "@root/modules/db";
import {
  AnalyticsAggregation,
  AnalyticsTimeRange,
  AnalyticsFilter,
  TimeSeriesPoint,
  GeographicUsage,
  AnalyticsEvent,
} from "../types/analytics.types";

@Injectable()
export class AnalyticsAggregationService {
  private readonly logger = new Logger(AnalyticsAggregationService.name);

  constructor(
    @InjectDatabase()
    private readonly database: Database,
  ) {}

  /**
   * Get overall platform analytics aggregation
   */
  async getPlatformAnalytics(
    timeRange: AnalyticsTimeRange,
    filters?: AnalyticsFilter,
  ): Promise<AnalyticsAggregation> {
    // Get aggregate metrics
    const [totalMetrics, topApiKeys, topUsers, topInstances, geographicBreakdown, timeSeriesData] =
      await Promise.all([
        this.getTotalMetrics(timeRange, filters),
        this.getTopApiKeys(timeRange, 10),
        this.getTopUsers(timeRange, 10),
        this.getTopInstances(timeRange, 10),
        this.getGeographicBreakdown(timeRange),
        this.getTimeSeriesData(timeRange),
      ]);

    return {
      totalRequests: totalMetrics.totalRequests,
      totalUsers: totalMetrics.totalUsers,
      totalApiKeys: totalMetrics.totalApiKeys,
      totalInstances: totalMetrics.totalInstances,
      averageResponseTime: totalMetrics.averageResponseTime,
      errorRate: totalMetrics.errorRate,
      topApiKeys,
      topUsers,
      topInstances,
      geographicBreakdown,
      timeSeriesData,
    };
  }

  /**
   * Get analytics dashboard data
   */
  async getDashboardAnalytics(timeRange: AnalyticsTimeRange, filters?: AnalyticsFilter) {
    const platformAnalytics = await this.getPlatformAnalytics(timeRange, filters);

    // Get additional dashboard-specific metrics
    const [growthMetrics, healthMetrics, alertMetrics, performanceInsights, usagePatterns] =
      await Promise.all([
        this.getGrowthMetrics(timeRange),
        this.getHealthMetrics(timeRange),
        this.getAlertMetrics(),
        this.getPerformanceInsights(),
        this.getUsagePatterns(),
      ]);

    return {
      ...platformAnalytics,
      growthMetrics,
      healthMetrics,
      alertMetrics,
      performanceInsights,
      usagePatterns,
    };
  }

  /**
   * Generate analytics report
   */
  async generateAnalyticsReport(timeRange: AnalyticsTimeRange, includeDetails: boolean = false) {
    const [platformAnalytics, apiKeyReport, userReport, instanceReport] = await Promise.all([
      this.getPlatformAnalytics(timeRange),
      this.generateApiKeyReport(),
      this.generateUserReport(),
      this.generateInstanceReport(),
    ]);

    const report = {
      meta: {
        generatedAt: new Date(),
        timeRange,
        version: "1.0",
      },
      summary: {
        ...platformAnalytics,
        insights: await this.generateInsights(platformAnalytics),
      },
      sections: {
        apiKeys: apiKeyReport,
        users: userReport,
        instances: instanceReport,
      },
    };

    if (includeDetails) {
      report.sections["detailed"] = await this.generateDetailedAnalytics();
    }

    return report;
  }

  /**
   * Track analytics event
   */
  async trackEvent(event: Omit<AnalyticsEvent, "id" | "timestamp">) {
    const fullEvent: AnalyticsEvent = {
      ...event,
      id: this.generateEventId(),
      timestamp: new Date(),
    };

    // Store event (would need an events table)
    this.logger.debug(`Analytics event tracked: ${fullEvent.type}`, {
      eventId: fullEvent.id,
      apiKeyId: fullEvent.apiKeyId,
      userId: fullEvent.userId,
    });

    // Update real-time metrics
    await this.updateRealTimeMetrics();

    return fullEvent.id;
  }

  /**
   * Get real-time analytics
   */
  async getRealTimeAnalytics() {
    const db = this.database;

    const currentTime = new Date();
    const oneHourAgo = new Date(currentTime.getTime() - 60 * 60 * 1000);

    const realTimeData = (await db.aggregate("sync_sessions", [
      { $match: { lastActivity: { $gte: oneHourAgo } } },
      {
        $group: {
          _id: null,
          current_requests: { $sum: 1 },
          users: { $addToSet: "$userId" },
          instances: { $addToSet: "$instanceId" },
          avg_response_time: { $avg: "$latencyMs" },
        },
      },
      {
        $set: {
          active_users: { $size: "$users" },
          active_instances: { $size: "$instances" },
          current_errors: null,
        },
      },
    ])) as any[];

    const data = realTimeData[0] || {};

    return {
      currentRequests: data.current_requests || 0,
      activeUsers: data.active_users || 0,
      activeInstances: data.active_instances || 0,
      averageResponseTime: data.avg_response_time || 0,
      currentErrors: data.current_errors || 0,
      timestamp: currentTime,
    };
  }

  /**
   * Get analytics alerts
   */
  async getAnalyticsAlerts(severity: "low" | "medium" | "high" | "critical" = "medium") {
    const alerts = [];

    // Check for high error rates
    const errorRateAlert = await this.checkErrorRateAlert();
    if (
      errorRateAlert &&
      this.getAlertSeverity(errorRateAlert) >= this.getSeverityLevel(severity)
    ) {
      alerts.push(errorRateAlert);
    }

    // Check for performance degradation
    const performanceAlert = await this.checkPerformanceAlert();
    if (
      performanceAlert &&
      this.getAlertSeverity(performanceAlert) >= this.getSeverityLevel(severity)
    ) {
      alerts.push(performanceAlert);
    }

    // Check for unusual usage patterns
    const usageAlert = await this.checkUsageAnomalies();
    if (usageAlert && this.getAlertSeverity(usageAlert) >= this.getSeverityLevel(severity)) {
      alerts.push(usageAlert);
    }

    // Check for quota violations
    const quotaAlert = await this.checkQuotaViolations();
    if (quotaAlert && this.getAlertSeverity(quotaAlert) >= this.getSeverityLevel(severity)) {
      alerts.push(quotaAlert);
    }

    return alerts.sort((a, b) => this.getAlertSeverity(b) - this.getAlertSeverity(a));
  }

  private async getTotalMetrics(timeRange: AnalyticsTimeRange, filters?: AnalyticsFilter) {
    const db = this.database;

    const metrics = (await db.aggregate("sync_storage_items", [
      {
        $match: {
          lastModified: { $gte: timeRange.start, $lte: timeRange.end },
          ...(filters?.userIds ? { userId: { $in: filters.userIds } } : {}),
          ...(filters?.instanceIds ? { instanceId: { $in: filters.instanceIds } } : {}),
        },
      },
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
          _id: null,
          total_requests: { $sum: 1 },
          users: { $addToSet: "$userId" },
          instances: { $addToSet: "$instanceId" },
          conflicts: { $sum: { $size: "$conflicts" } },
        },
      },
      {
        $set: {
          total_users: { $size: "$users" },
          total_instances: { $size: "$instances" },
          error_rate: { $divide: ["$conflicts", "$total_requests"] },
          average_response_time: null,
        },
      },
    ])) as any[];

    const apiKeyCount = (await db.aggregate("api_keys", [
      { $match: { createdAt: { $lte: timeRange.end } } },
      { $count: "total_api_keys" },
    ])) as any[];

    const data = metrics[0] || {};
    const apiKeys = apiKeyCount[0] || {};

    return {
      totalRequests: data.total_requests || 0,
      totalUsers: data.total_users || 0,
      totalApiKeys: apiKeys.total_api_keys || 0,
      totalInstances: data.total_instances || 0,
      averageResponseTime: data.average_response_time || 0,
      errorRate: data.error_rate || 0,
    };
  }

  private async getTopApiKeys(timeRange: AnalyticsTimeRange, limit: number) {
    const db = this.database;

    const results = (await db.aggregate("api_keys", [
      { $match: { createdAt: { $lte: timeRange.end } } },
      { $sort: { totalCalls: -1 } },
      { $limit: limit },
      { $project: { id: "$_id", name: 1, requests: "$totalCalls" } },
    ])) as any[];

    return results.map((item) => ({
      id: item.id,
      name: item.name,
      requests: item.requests,
    }));
  }

  private async getTopUsers(timeRange: AnalyticsTimeRange, limit: number) {
    const db = this.database;

    const results = (await db.aggregate("sync_storage_items", [
      { $match: { lastModified: { $gte: timeRange.start, $lte: timeRange.end } } },
      { $group: { _id: "$userId", requests: { $sum: 1 }, last_active: { $max: "$lastModified" } } },
      { $sort: { requests: -1 } },
      { $limit: limit },
      { $set: { id: "$_id" } },
    ])) as any[];

    return results.map((item) => ({
      id: item.id,
      requests: item.requests,
      lastActive: item.last_active,
    }));
  }

  private async getTopInstances(timeRange: AnalyticsTimeRange, limit: number) {
    const db = this.database;

    const results = (await db.aggregate("sync_storage_items", [
      { $match: { lastModified: { $gte: timeRange.start, $lte: timeRange.end } } },
      { $group: { _id: { instance: "$instanceId", user: "$userId" }, requests: { $sum: 1 } } },
      { $sort: { requests: -1 } },
      { $limit: limit },
      { $set: { id: "$_id.instance", userId: "$_id.user" } },
    ])) as any[];

    return results.map((item) => ({
      id: item.id,
      userId: item.userId,
      requests: item.requests,
    }));
  }

  private async getGeographicBreakdown(timeRange: AnalyticsTimeRange): Promise<GeographicUsage[]> {
    const db = this.database;

    const results = (await db.aggregate("sync_sessions", [
      {
        $match: {
          connectedAt: { $gte: timeRange.start, $lte: timeRange.end },
          country: { $ne: null },
        },
      },
      {
        $group: {
          _id: { country: "$country", city: "$city" },
          request_count: { $sum: 1 },
          users: { $addToSet: "$userId" },
          average_response_time: { $avg: "$latencyMs" },
        },
      },
      { $set: { country: "$_id.country", city: "$_id.city", unique_users: { $size: "$users" } } },
      { $sort: { request_count: -1 } },
      { $limit: 50 },
    ])) as any[];

    return results.map((item) => ({
      country: item.country,
      city: item.city,
      requestCount: item.request_count,
      uniqueUsers: item.unique_users,
      averageResponseTime: item.average_response_time || 0,
    }));
  }

  private async getTimeSeriesData(timeRange: AnalyticsTimeRange): Promise<TimeSeriesPoint[]> {
    const db = this.database;

    const results = (await db.aggregate("sync_storage_items", [
      { $match: { lastModified: { $gte: timeRange.start, $lte: timeRange.end } } },
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
          _id: { $dateTrunc: { date: "$lastModified", unit: timeRange.granularity } },
          requests: { $sum: 1 },
          errors: { $sum: { $size: "$conflicts" } },
          users: { $addToSet: "$userId" },
        },
      },
      { $set: { timestamp: "$_id", response_time: null, active_users: { $size: "$users" } } },
      { $sort: { timestamp: 1 } },
    ])) as any[];

    return results.map((item) => ({
      timestamp: item.timestamp,
      requests: item.requests,
      responseTime: item.response_time || 0,
      errors: item.errors,
      activeUsers: item.active_users,
    }));
  }

  private async getGrowthMetrics(timeRange: AnalyticsTimeRange) {
    const currentPeriod = await this.getTotalMetrics(timeRange);

    const previousStart = new Date(
      timeRange.start.getTime() - (timeRange.end.getTime() - timeRange.start.getTime()),
    );
    const previousEnd = timeRange.start;
    const previousPeriod = await this.getTotalMetrics({
      start: previousStart,
      end: previousEnd,
      granularity: timeRange.granularity,
    });

    return {
      userGrowth: this.calculateGrowthRate(previousPeriod.totalUsers, currentPeriod.totalUsers),
      requestGrowth: this.calculateGrowthRate(
        previousPeriod.totalRequests,
        currentPeriod.totalRequests,
      ),
      instanceGrowth: this.calculateGrowthRate(
        previousPeriod.totalInstances,
        currentPeriod.totalInstances,
      ),
      apiKeyGrowth: this.calculateGrowthRate(
        previousPeriod.totalApiKeys,
        currentPeriod.totalApiKeys,
      ),
    };
  }

  private async getHealthMetrics(timeRange: AnalyticsTimeRange) {
    const db = this.database;

    const health = (await db.aggregate("sync_storage_items", [
      { $match: { lastModified: { $gte: timeRange.start, $lte: timeRange.end } } },
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
          _id: null,
          total_operations: { $sum: 1 },
          successful_operations: { $sum: { $cond: [{ $eq: [{ $size: "$conflicts" }, 0] }, 1, 0] } },
        },
      },
    ])) as any[];

    const data = health[0] || {};

    return {
      successRate: (data.successful_operations || 0) / (data.total_operations || 1),
      averageLatency: data.avg_latency || 0,
      activeConnections: data.active_connections || 0,
      systemHealth: this.calculateSystemHealth(data),
    };
  }

  private async getAlertMetrics() {
    // This would integrate with the alerts system
    return {
      criticalAlerts: 0,
      warningAlerts: 0,
      infoAlerts: 0,
    };
  }

  private async getPerformanceInsights() {
    const db = this.database;
    const currentTime = new Date();
    const oneHourAgo = new Date(currentTime.getTime() - 60 * 60 * 1000);

    const insights = (await db.aggregate("sync_sessions", [
      { $match: { connectedAt: { $gte: oneHourAgo, $lte: currentTime } } },
      {
        $group: {
          _id: null,
          quantiles: {
            $percentile: { input: "$latencyMs", p: [0.95, 0.99], method: "approximate" },
          },
          max_latency: { $max: "$latencyMs" },
          min_latency: { $min: "$latencyMs" },
        },
      },
      {
        $set: {
          p95_latency: { $arrayElemAt: ["$quantiles", 0] },
          p99_latency: { $arrayElemAt: ["$quantiles", 1] },
        },
      },
    ])) as any[];

    const data = insights[0] || {};

    return {
      p95Latency: data.p95_latency || 0,
      p99Latency: data.p99_latency || 0,
      maxLatency: data.max_latency || 0,
      minLatency: data.min_latency || 0,
      performanceScore: this.calculatePerformanceScore(data),
    };
  }

  private async getUsagePatterns() {
    const db = this.database;
    const currentTime = new Date();
    const oneDayAgo = new Date(currentTime.getTime() - 24 * 60 * 60 * 1000);

    const patterns = (await db.aggregate("sync_storage_items", [
      { $match: { lastModified: { $gte: oneDayAgo, $lte: currentTime } } },
      {
        $group: {
          _id: { hour: { $hour: "$lastModified" }, day: { $dayOfWeek: "$lastModified" } },
          operation_count: { $sum: 1 },
        },
      },
      { $set: { hour: "$_id.hour", day_of_week: "$_id.day" } },
      { $sort: { operation_count: -1 } },
      { $limit: 10 },
    ])) as any[];

    return {
      peakHours: patterns.map((p) => ({ hour: p.hour, count: p.operation_count })),
      peakDays: patterns.map((p) => ({ day: p.day_of_week, count: p.operation_count })),
    };
  }

  private async generateApiKeyReport() {
    // Generate API key analytics report
    return {
      summary: "API key performance and usage analysis",
      topPerformers: [],
      securityInsights: [],
      recommendations: [],
    };
  }

  private async generateUserReport() {
    // Generate user analytics report
    return {
      summary: "User engagement and behavior analysis",
      engagementMetrics: [],
      behaviorPatterns: [],
      cohortAnalysis: [],
    };
  }

  private async generateInstanceReport() {
    // Generate instance analytics report
    return {
      summary: "Instance performance and reliability analysis",
      performanceMetrics: [],
      reliabilityMetrics: [],
      resourceUtilization: [],
    };
  }

  private async generateDetailedAnalytics() {
    // Generate detailed analytics data
    return {
      rawMetrics: [],
      detailedBreakdowns: [],
      advancedInsights: [],
    };
  }

  private async generateInsights(analytics: AnalyticsAggregation) {
    const insights: any[] = [];

    // Performance insights
    if (analytics.averageResponseTime > 1000) {
      insights.push({
        type: "performance",
        severity: "warning",
        message: "Average response time is higher than optimal",
        recommendation: "Consider optimizing database queries or adding caching",
      });
    }

    // Usage insights
    if (analytics.totalRequests > 1000000) {
      insights.push({
        type: "scale",
        severity: "info",
        message: "High request volume detected",
        recommendation: "Monitor scaling requirements and consider load balancing",
      });
    }

    // Error rate insights
    if (analytics.errorRate > 0.05) {
      insights.push({
        type: "reliability",
        severity: "critical",
        message: "Error rate exceeds acceptable threshold",
        recommendation: "Investigate error patterns and implement fixes",
      });
    }

    return insights;
  }

  private async updateRealTimeMetrics() {
    // Update real-time metrics based on event
    // This would typically update Redis or in-memory cache
  }

  private async checkErrorRateAlert() {
    // Implement error rate checking
    return null;
  }

  private async checkPerformanceAlert() {
    // Implement performance degradation checking
    return null;
  }

  private async checkUsageAnomalies() {
    // Implement usage anomaly detection
    return null;
  }

  private async checkQuotaViolations() {
    // Implement quota violation checking
    return null;
  }

  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private getAlertSeverity(alert: any): number {
    const severityMap = { low: 1, medium: 2, high: 3, critical: 4 };
    return severityMap[alert.severity] || 1;
  }

  private getSeverityLevel(severity: string): number {
    const severityMap = { low: 1, medium: 2, high: 3, critical: 4 };
    return severityMap[severity] || 2;
  }

  private calculateGrowthRate(previous: number, current: number): number {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  }

  private calculateSystemHealth(data: any): number {
    let health = 100;
    const successOps = Number(data.successful_operations || 0);
    const totalOps = Number(data.total_operations || 1);
    const avgLatency = Number(data.avg_latency || 0);

    const successRate = successOps / totalOps;

    health -= (1 - successRate) * 50;

    if (avgLatency > 1000) {
      health -= Math.min((avgLatency - 1000) / 100, 25);
    }

    return Math.max(0, Math.min(100, health));
  }

  private calculatePerformanceScore(data: any): number {
    let score = 100;
    const p95Latency = Number(data.p95_latency || 0);
    const p99Latency = Number(data.p99_latency || 0);

    if (p95Latency > 1000) {
      score -= Math.min((p95Latency - 1000) / 100, 30);
    }

    if (p99Latency > 2000) {
      score -= Math.min((p99Latency - 2000) / 100, 20);
    }

    return Math.max(0, Math.min(100, score));
  }
}
