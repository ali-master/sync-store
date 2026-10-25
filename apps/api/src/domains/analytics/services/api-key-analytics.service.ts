import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectDatabase, Database } from "@root/modules/db";
import type { AnalyticsTimeRange } from "../types/analytics.types";

/** Reports stored counters without inventing historical samples or source IPs. */
@Injectable()
export class ApiKeyAnalyticsService {
  constructor(@InjectDatabase() private readonly database: Database) {}

  private async key(id: string) {
    const key = await this.database.orm.api_keys.where({ id }).first();
    if (!key) throw new NotFoundException("API key not found");
    return key;
  }

  async getApiKeyAnalytics(apiKeyId: string, _timeRange: AnalyticsTimeRange) {
    const key = await this.key(apiKeyId);
    return {
      apiKeyId,
      keyName: key.name,
      totalRequests: key.totalCalls,
      successfulRequests: key.successfulCalls,
      failedRequests: key.failedCalls,
      averageResponseTime: key.avgResponseTimeMs,
      peakUsageHour: null,
      quotaUtilization:
        key.dailyQuota == null
          ? null
          : key.dailyQuota === 0
            ? 100
            : (key.currentDailyUsage / key.dailyQuota) * 100,
      topEndpoints: [],
      errorRates: [],
      geographicDistribution: [],
      timeSeriesData: [],
      measurementScope: "lifetime",
      unavailableMetrics: [
        "peakUsageHour",
        "topEndpoints",
        "errorRates",
        "geographicDistribution",
        "timeSeriesData",
      ],
    };
  }

  async getMultipleApiKeyAnalytics(apiKeyIds: string[], timeRange: AnalyticsTimeRange) {
    return (await Promise.all(apiKeyIds.map((id) => this.getApiKeyAnalytics(id, timeRange)))).sort(
      (a, b) => b.totalRequests - a.totalRequests,
    );
  }

  async getApiKeyComparison(
    apiKeyIds: string[],
    timeRange: AnalyticsTimeRange,
    metric: "requests" | "response_time" | "error_rate" | "quota_usage" = "requests",
  ) {
    const analytics = await this.getMultipleApiKeyAnalytics(apiKeyIds, timeRange);
    return analytics
      .map((a) => ({
        apiKeyId: a.apiKeyId,
        keyName: a.keyName,
        value:
          metric === "requests"
            ? a.totalRequests
            : metric === "response_time"
              ? a.averageResponseTime
              : metric === "quota_usage"
                ? a.quotaUtilization
                : a.totalRequests
                  ? a.failedRequests / a.totalRequests
                  : 0,
      }))
      .sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
      .map((item, index) => ({ ...item, rank: index + 1 }));
  }

  async getApiKeyTrends(apiKeyId: string, _timeRange: AnalyticsTimeRange) {
    await this.key(apiKeyId);
    return { available: false, reason: "Historical request samples are not recorded", data: [] };
  }

  async getSecurityInsights(apiKeyId: string, _timeRange: AnalyticsTimeRange) {
    const key = await this.key(apiKeyId);
    return {
      suspiciousIPs: [],
      unusualPatterns: [],
      rateLimitViolations: [],
      securityScore: null,
      securityViolations: key.securityViolations,
      lastSecurityViolation: key.lastSecurityViolation,
      measurementScope: "lifetime",
      unavailableMetrics: [
        "suspiciousIPs",
        "unusualPatterns",
        "rateLimitViolations",
        "securityScore",
      ],
    };
  }
}
