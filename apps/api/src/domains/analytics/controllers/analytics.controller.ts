import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam } from "@nestjs/swagger";
import { ApiKeyAuth } from "@root/domains/sync-storage/decorators/api-key-auth.decorator";
import {
  getUserId,
  getInstanceId,
  getIpAddress,
  getUserAgent,
} from "@root/modules/context/context.storage";
import { ApiKeyAnalyticsService } from "../services/api-key-analytics.service";
import { UserAnalyticsService } from "../services/user-analytics.service";
import { InstanceAnalyticsService } from "../services/instance-analytics.service";
import { AnalyticsAggregationService } from "../services/analytics-aggregation.service";
import { AnalyticsTimeRange, AnalyticsFilter, AnalyticsEventType } from "../types/analytics.types";
import { convertBigIntToNumber } from "@root/utils/bigint-converter.util";

interface AnalyticsQueryDto {
  startDate?: string;
  endDate?: string;
  granularity?: "minute" | "hour" | "day" | "week" | "month";
  apiKeys?: string;
  userIds?: string;
  instanceIds?: string;
  endpoints?: string;
  countries?: string;
  deviceTypes?: string;
}

interface EventTrackingDto {
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
  metadata?: Record<string, any>;
}

@ApiTags("Analytics")
@Controller("analytics")
@ApiKeyAuth()
export class AnalyticsController {
  constructor(
    private readonly apiKeyAnalyticsService: ApiKeyAnalyticsService,
    private readonly userAnalyticsService: UserAnalyticsService,
    private readonly instanceAnalyticsService: InstanceAnalyticsService,
    private readonly aggregationService: AnalyticsAggregationService,
  ) {}

  /**
   * Get platform-wide analytics dashboard
   */
  @Get("dashboard")
  @ApiOperation({ summary: "Get analytics dashboard data" })
  @ApiQuery({ name: "startDate", required: false, description: "Start date (ISO string)" })
  @ApiQuery({ name: "endDate", required: false, description: "End date (ISO string)" })
  @ApiQuery({
    name: "granularity",
    required: false,
    enum: ["minute", "hour", "day", "week", "month"],
  })
  @ApiResponse({ status: 200, description: "Dashboard analytics retrieved successfully" })
  async getDashboard(@Query() query: AnalyticsQueryDto) {
    const timeRange = this.parseTimeRange(query);
    const filters = this.parseFilters(query);
    const result = await this.aggregationService.getDashboardAnalytics(timeRange, filters);

    return convertBigIntToNumber(result);
  }

  /**
   * Get platform aggregated analytics
   */
  @Get("platform")
  @ApiOperation({ summary: "Get platform-wide aggregated analytics" })
  @ApiQuery({ name: "startDate", required: false, description: "Start date (ISO string)" })
  @ApiQuery({ name: "endDate", required: false, description: "End date (ISO string)" })
  @ApiResponse({ status: 200, description: "Platform analytics retrieved successfully" })
  async getPlatformAnalytics(@Query() query: AnalyticsQueryDto) {
    const timeRange = this.parseTimeRange(query);
    const filters = this.parseFilters(query);
    const result = await this.aggregationService.getPlatformAnalytics(timeRange, filters);

    return convertBigIntToNumber(result);
  }

  /**
   * Get real-time analytics
   */
  @Get("realtime")
  @ApiOperation({ summary: "Get real-time analytics data" })
  @ApiResponse({ status: 200, description: "Real-time analytics retrieved successfully" })
  async getRealTimeAnalytics() {
    const result = await this.aggregationService.getRealTimeAnalytics();

    return convertBigIntToNumber(result);
  }

  /**
   * Get analytics alerts
   */
  @Get("alerts")
  @ApiOperation({ summary: "Get analytics alerts and warnings" })
  @ApiQuery({ name: "severity", required: false, enum: ["low", "medium", "high", "critical"] })
  @ApiResponse({ status: 200, description: "Analytics alerts retrieved successfully" })
  async getAlerts(@Query("severity") severity?: "low" | "medium" | "high" | "critical") {
    const result = await this.aggregationService.getAnalyticsAlerts(severity);

    return convertBigIntToNumber(result);
  }

  /**
   * Generate analytics report
   */
  @Get("report")
  @ApiOperation({ summary: "Generate comprehensive analytics report" })
  @ApiQuery({ name: "startDate", required: false, description: "Start date (ISO string)" })
  @ApiQuery({ name: "endDate", required: false, description: "End date (ISO string)" })
  @ApiQuery({ name: "includeDetails", required: false, description: "Include detailed analytics" })
  @ApiResponse({ status: 200, description: "Analytics report generated successfully" })
  async generateReport(@Query() query: AnalyticsQueryDto & { includeDetails?: string }) {
    const timeRange = this.parseTimeRange(query);
    const includeDetails = query.includeDetails === "true";
    const result = await this.aggregationService.generateAnalyticsReport(timeRange, includeDetails);

    return {
      report: convertBigIntToNumber(result),
      generatedAt: new Date(),
    };
  }

  /**
   * Get API key analytics
   */
  @Get("api-keys/:apiKeyId")
  @ApiOperation({ summary: "Get analytics for a specific API key" })
  @ApiParam({ name: "apiKeyId", description: "API Key ID" })
  @ApiQuery({ name: "startDate", required: false, description: "Start date (ISO string)" })
  @ApiQuery({ name: "endDate", required: false, description: "End date (ISO string)" })
  @ApiResponse({ status: 200, description: "API key analytics retrieved successfully" })
  @ApiResponse({ status: 404, description: "API key not found" })
  async getApiKeyAnalytics(@Param("apiKeyId") apiKeyId: string, @Query() query: AnalyticsQueryDto) {
    try {
      const timeRange = this.parseTimeRange(query);
      const result = await this.apiKeyAnalyticsService.getApiKeyAnalytics(apiKeyId, timeRange);

      return convertBigIntToNumber(result);
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        throw new NotFoundException(`API key ${apiKeyId} not found`);
      }
      throw error;
    }
  }

  /**
   * Get API key security insights
   */
  @Get("api-keys/:apiKeyId/security")
  @ApiOperation({ summary: "Get security insights for a specific API key" })
  @ApiParam({ name: "apiKeyId", description: "API Key ID" })
  @ApiQuery({ name: "startDate", required: false, description: "Start date (ISO string)" })
  @ApiQuery({ name: "endDate", required: false, description: "End date (ISO string)" })
  @ApiResponse({ status: 200, description: "Security insights retrieved successfully" })
  async getApiKeySecurityInsights(
    @Param("apiKeyId") apiKeyId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    const timeRange = this.parseTimeRange(query);
    const result = await this.apiKeyAnalyticsService.getSecurityInsights(apiKeyId, timeRange);

    return convertBigIntToNumber(result);
  }

  /**
   * Get API key performance trends
   */
  @Get("api-keys/:apiKeyId/trends")
  @ApiOperation({ summary: "Get performance trends for a specific API key" })
  @ApiParam({ name: "apiKeyId", description: "API Key ID" })
  @ApiQuery({ name: "startDate", required: false, description: "Start date (ISO string)" })
  @ApiQuery({ name: "endDate", required: false, description: "End date (ISO string)" })
  @ApiResponse({ status: 200, description: "Performance trends retrieved successfully" })
  async getApiKeyTrends(@Param("apiKeyId") apiKeyId: string, @Query() query: AnalyticsQueryDto) {
    const timeRange = this.parseTimeRange(query);
    const result = await this.apiKeyAnalyticsService.getApiKeyTrends(apiKeyId, timeRange);

    return convertBigIntToNumber(result);
  }

  /**
   * Compare multiple API keys
   */
  @Post("api-keys/compare")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Compare analytics for multiple API keys" })
  @ApiResponse({ status: 200, description: "API key comparison completed successfully" })
  async compareApiKeys(
    @Body()
    body: {
      apiKeyIds: string[];
      startDate?: string;
      endDate?: string;
      metric?: "requests" | "response_time" | "error_rate" | "quota_usage";
    },
  ) {
    const timeRange = this.parseTimeRange(body);
    const result = await this.apiKeyAnalyticsService.getApiKeyComparison(
      body.apiKeyIds,
      timeRange,
      body.metric,
    );

    return convertBigIntToNumber(result);
  }

  /**
   * Get user analytics
   */
  @Get("users/:userId")
  @ApiOperation({ summary: "Get analytics for a specific user" })
  @ApiParam({ name: "userId", description: "User ID" })
  @ApiQuery({ name: "startDate", required: false, description: "Start date (ISO string)" })
  @ApiQuery({ name: "endDate", required: false, description: "End date (ISO string)" })
  @ApiResponse({ status: 200, description: "User analytics retrieved successfully" })
  async getUserAnalytics(@Param("userId") userId: string, @Query() query: AnalyticsQueryDto) {
    const timeRange = this.parseTimeRange(query);

    const result = await this.userAnalyticsService.getUserAnalytics(userId, timeRange);

    return convertBigIntToNumber(result);
  }

  /**
   * Get user engagement metrics
   */
  @Get("users/:userId/engagement")
  @ApiOperation({ summary: "Get engagement metrics for a specific user" })
  @ApiParam({ name: "userId", description: "User ID" })
  @ApiQuery({ name: "startDate", required: false, description: "Start date (ISO string)" })
  @ApiQuery({ name: "endDate", required: false, description: "End date (ISO string)" })
  @ApiResponse({ status: 200, description: "User engagement metrics retrieved successfully" })
  async getUserEngagement(@Param("userId") userId: string, @Query() query: AnalyticsQueryDto) {
    const timeRange = this.parseTimeRange(query);
    const result = await this.userAnalyticsService.getUserEngagementMetrics(userId, timeRange);

    return convertBigIntToNumber(result);
  }

  /**
   * Get user behavior patterns
   */
  @Get("users/:userId/behavior")
  @ApiOperation({ summary: "Get behavior patterns for a specific user" })
  @ApiParam({ name: "userId", description: "User ID" })
  @ApiQuery({ name: "startDate", required: false, description: "Start date (ISO string)" })
  @ApiQuery({ name: "endDate", required: false, description: "End date (ISO string)" })
  @ApiResponse({ status: 200, description: "User behavior patterns retrieved successfully" })
  async getUserBehavior(@Param("userId") userId: string, @Query() query: AnalyticsQueryDto) {
    const timeRange = this.parseTimeRange(query);
    const result = await this.userAnalyticsService.getUserBehaviorPatterns(userId, timeRange);

    return convertBigIntToNumber(result);
  }

  /**
   * Compare multiple users
   */
  @Post("users/compare")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Compare analytics for multiple users" })
  @ApiResponse({ status: 200, description: "User comparison completed successfully" })
  async compareUsers(
    @Body()
    body: {
      userIds: string[];
      startDate?: string;
      endDate?: string;
      metric?: "operations" | "storage" | "sessions" | "conflicts";
    },
  ) {
    const timeRange = this.parseTimeRange(body);
    const result = await this.userAnalyticsService.compareUsers(
      body.userIds,
      timeRange,
      body.metric,
    );

    return convertBigIntToNumber(result);
  }

  /**
   * Get user cohort analysis
   */
  @Get("users/cohort")
  @ApiOperation({ summary: "Get user cohort analysis" })
  @ApiQuery({
    name: "cohort",
    required: false,
    enum: ["registration_date", "first_sync", "first_conflict"],
  })
  @ApiQuery({ name: "startDate", required: false, description: "Start date (ISO string)" })
  @ApiQuery({ name: "endDate", required: false, description: "End date (ISO string)" })
  @ApiResponse({ status: 200, description: "Cohort analysis retrieved successfully" })
  async getUserCohortAnalysis(
    @Query()
    query: AnalyticsQueryDto & { cohort?: "registration_date" | "first_sync" | "first_conflict" },
  ) {
    const timeRange = this.parseTimeRange(query);

    const result = await this.userAnalyticsService.getUserCohortAnalysis(timeRange);

    return convertBigIntToNumber(result);
  }

  /**
   * Get instance analytics
   */
  @Get("instances/:instanceId")
  @ApiOperation({ summary: "Get analytics for a specific instance" })
  @ApiParam({ name: "instanceId", description: "Instance ID" })
  @ApiQuery({ name: "startDate", required: false, description: "Start date (ISO string)" })
  @ApiQuery({ name: "endDate", required: false, description: "End date (ISO string)" })
  @ApiResponse({ status: 200, description: "Instance analytics retrieved successfully" })
  @ApiResponse({ status: 404, description: "Instance not found" })
  async getInstanceAnalytics(
    @Param("instanceId") instanceId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    try {
      const timeRange = this.parseTimeRange(query);

      const result = await this.instanceAnalyticsService.getInstanceAnalytics(
        instanceId,
        timeRange,
      );

      return convertBigIntToNumber(result);
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        throw new NotFoundException(`Instance ${instanceId} not found`);
      }
      throw error;
    }
  }

  /**
   * Get instance performance trends
   */
  @Get("instances/:instanceId/performance")
  @ApiOperation({ summary: "Get performance trends for a specific instance" })
  @ApiParam({ name: "instanceId", description: "Instance ID" })
  @ApiQuery({ name: "startDate", required: false, description: "Start date (ISO string)" })
  @ApiQuery({ name: "endDate", required: false, description: "End date (ISO string)" })
  @ApiResponse({ status: 200, description: "Performance trends retrieved successfully" })
  async getInstancePerformance(
    @Param("instanceId") instanceId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    const timeRange = this.parseTimeRange(query);
    const result = await this.instanceAnalyticsService.getInstancePerformanceTrends(
      instanceId,
      timeRange,
    );

    return convertBigIntToNumber(result);
  }

  /**
   * Get instance reliability metrics
   */
  @Get("instances/:instanceId/reliability")
  @ApiOperation({ summary: "Get reliability metrics for a specific instance" })
  @ApiParam({ name: "instanceId", description: "Instance ID" })
  @ApiQuery({ name: "startDate", required: false, description: "Start date (ISO string)" })
  @ApiQuery({ name: "endDate", required: false, description: "End date (ISO string)" })
  @ApiResponse({ status: 200, description: "Reliability metrics retrieved successfully" })
  async getInstanceReliability(
    @Param("instanceId") instanceId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    const timeRange = this.parseTimeRange(query);
    const result = await this.instanceAnalyticsService.getInstanceReliabilityMetrics(
      instanceId,
      timeRange,
    );

    return convertBigIntToNumber(result);
  }

  /**
   * Get instance resource utilization
   */
  @Get("instances/:instanceId/utilization")
  @ApiOperation({ summary: "Get resource utilization for a specific instance" })
  @ApiParam({ name: "instanceId", description: "Instance ID" })
  @ApiQuery({ name: "startDate", required: false, description: "Start date (ISO string)" })
  @ApiQuery({ name: "endDate", required: false, description: "End date (ISO string)" })
  @ApiResponse({ status: 200, description: "Resource utilization retrieved successfully" })
  async getInstanceUtilization(
    @Param("instanceId") instanceId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    const timeRange = this.parseTimeRange(query);
    const result = await this.instanceAnalyticsService.getInstanceResourceUtilization(
      instanceId,
      timeRange,
    );

    return convertBigIntToNumber(result);
  }

  /**
   * Get instance health status
   */
  @Get("instances/:instanceId/health")
  @ApiOperation({ summary: "Get health status for a specific instance" })
  @ApiParam({ name: "instanceId", description: "Instance ID" })
  @ApiResponse({ status: 200, description: "Instance health status retrieved successfully" })
  async getInstanceHealth(@Param("instanceId") instanceId: string) {
    const result = await this.instanceAnalyticsService.getInstanceHealthStatus(instanceId);

    return convertBigIntToNumber(result);
  }

  /**
   * Compare multiple instances
   */
  @Post("instances/compare")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Compare analytics for multiple instances" })
  @ApiResponse({ status: 200, description: "Instance comparison completed successfully" })
  async compareInstances(
    @Body()
    body: {
      instanceIds: string[];
      startDate?: string;
      endDate?: string;
      metric?: "performance" | "reliability" | "utilization" | "activity";
    },
  ) {
    const timeRange = this.parseTimeRange(body);
    const result = await this.instanceAnalyticsService.compareInstances(
      body.instanceIds,
      timeRange,
      body.metric,
    );

    return convertBigIntToNumber(result);
  }

  /**
   * Track analytics event
   */
  @Post("events")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Track an analytics event" })
  @ApiResponse({ status: 201, description: "Event tracked successfully" })
  async trackEvent(@Body() eventDto: EventTrackingDto) {
    const event = {
      ...eventDto,
      userId: eventDto.userId || getUserId(),
      instanceId: eventDto.instanceId || getInstanceId(),
      ipAddress: getIpAddress(),
      userAgent: getUserAgent(),
    };

    const eventId = await this.aggregationService.trackEvent(event);

    return {
      eventId,
      message: "Event tracked successfully",
      timestamp: new Date(),
    };
  }

  /**
   * Get my analytics (current user/API key)
   */
  @Get("my/summary")
  @ApiOperation({ summary: "Get analytics summary for the current context" })
  @ApiQuery({ name: "startDate", required: false, description: "Start date (ISO string)" })
  @ApiQuery({ name: "endDate", required: false, description: "End date (ISO string)" })
  @ApiResponse({ status: 200, description: "Personal analytics summary retrieved successfully" })
  async getMyAnalytics(@Query() query: AnalyticsQueryDto) {
    const timeRange = this.parseTimeRange(query);
    const userId = getUserId();
    const instanceId = getInstanceId();

    if (!userId) {
      throw new BadRequestException("User ID is required");
    }

    const [userAnalytics, instanceAnalytics] = await Promise.all([
      this.userAnalyticsService.getUserAnalytics(userId, timeRange),
      instanceId ? this.instanceAnalyticsService.getInstanceAnalytics(instanceId, timeRange) : null,
    ]);

    return convertBigIntToNumber({
      user: userAnalytics,
      instance: instanceAnalytics,
      summary: {
        totalOperations: userAnalytics.totalOperations,
        totalSessions: userAnalytics.totalSessions,
        storageUsage: userAnalytics.storageUsage.totalSizeBytes,
        conflictRate: userAnalytics.conflictRate,
        averageSessionDuration: userAnalytics.averageSessionDuration,
        instanceHealth: instanceAnalytics
          ? await this.instanceAnalyticsService.getInstanceHealthStatus(instanceId)
          : null,
      },
    });
  }

  private parseTimeRange(query: any): AnalyticsTimeRange {
    const now = new Date();
    const defaultStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

    const start = query.startDate ? new Date(query.startDate) : defaultStart;
    const end = query.endDate ? new Date(query.endDate) : now;
    const granularity = query.granularity || "day";

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException("Invalid date format. Use ISO 8601 format.");
    }

    if (start >= end) {
      throw new BadRequestException("Start date must be before end date.");
    }

    return { start, end, granularity };
  }

  private parseFilters(query: AnalyticsQueryDto): AnalyticsFilter | undefined {
    const filters: AnalyticsFilter = {};
    let hasFilters = false;

    if (query.apiKeys) {
      filters.apiKeys = query.apiKeys.split(",");
      hasFilters = true;
    }

    if (query.userIds) {
      filters.userIds = query.userIds.split(",");
      hasFilters = true;
    }

    if (query.instanceIds) {
      filters.instanceIds = query.instanceIds.split(",");
      hasFilters = true;
    }

    if (query.endpoints) {
      filters.endpoints = query.endpoints.split(",");
      hasFilters = true;
    }

    if (query.countries) {
      filters.countries = query.countries.split(",");
      hasFilters = true;
    }

    if (query.deviceTypes) {
      filters.deviceTypes = query.deviceTypes.split(",");
      hasFilters = true;
    }

    return hasFilters ? filters : undefined;
  }
}
