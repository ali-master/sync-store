import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from "@nestjs/swagger";
import {
  ConflictResolutionService,
  ConflictResolutionStrategy,
} from "../services/conflict-resolution.service";
import { getUserId, getInstanceId } from "@root/modules/context/context.storage";
import { ApiKeyAuth } from "../decorators/api-key-auth.decorator";

interface ResolveConflictDto {
  strategy: ConflictResolutionStrategy;
  aiModel?: string;
  userReview?: boolean;
}

interface ConflictStatsQuery {
  startDate?: string;
  endDate?: string;
}

@ApiTags("Conflict Resolution")
@Controller("sync-storage/conflicts")
@ApiKeyAuth()
export class ConflictResolutionController {
  constructor(private readonly conflictResolutionService: ConflictResolutionService) {}

  @Get("history/:itemId")
  @ApiOperation({ summary: "Get conflict history for an item" })
  @ApiResponse({
    status: 200,
    description: "Conflict history retrieved successfully",
  })
  @ApiQuery({
    name: "itemId",
    required: true,
    description: "ID of the item to retrieve conflict history for",
  })
  async getConflictHistory(@Param("itemId") itemId: string) {
    const history = await this.conflictResolutionService.getConflictHistory(itemId);

    return {
      itemId,
      conflicts: history.map((conflict) => ({
        id: conflict.id,
        conflictType: conflict.conflictType,
        status: conflict.status,
        strategy: conflict.resolutionStrategy,
        confidence: conflict.confidence,
        reason: conflict.resolutionReason,
        createdAt: conflict.createdAt,
        resolvedAt: conflict.resolvedAt,
        aiModel: conflict.aiModel,
        humanReviewed: conflict.humanReviewed,
      })),
      total: history.length,
    };
  }

  @Get("stats")
  @ApiOperation({ summary: "Get conflict statistics for current user" })
  @ApiQuery({
    name: "startDate",
    required: false,
    description: "Start date for statistics (ISO string)",
  })
  @ApiQuery({
    name: "endDate",
    required: false,
    description: "End date for statistics (ISO string)",
  })
  @ApiResponse({
    status: 200,
    description: "Conflict statistics retrieved successfully",
  })
  async getConflictStats(@Query() query: ConflictStatsQuery) {
    const userId = getUserId();

    if (!userId) {
      throw new BadRequestException("User ID is required");
    }

    const timeRange = {
      start: query.startDate
        ? new Date(query.startDate)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
      end: query.endDate ? new Date(query.endDate) : new Date(),
    };

    const stats = await this.conflictResolutionService.getUserConflictStats(userId, timeRange);

    return {
      userId,
      timeRange,
      statistics: stats,
      insights: {
        resolutionEfficiency: stats.autoResolutionRate,
        mostCommonConflictType: Object.entries(stats.conflictsByType).reduce(
          (a, b) => (stats.conflictsByType[a[0]] > stats.conflictsByType[b[0]] ? a : b),
          ["none", 0],
        )[0],
        averageConflictsPerDay:
          stats.totalConflicts /
          Math.max(
            1,
            Math.ceil(
              (timeRange.end.getTime() - timeRange.start.getTime()) / (24 * 60 * 60 * 1000),
            ),
          ),
      },
    };
  }

  @Put("resolve/:conflictId")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Resolve a specific conflict" })
  @ApiResponse({
    status: 200,
    description: "Conflict resolved successfully",
  })
  @ApiResponse({
    status: 404,
    description: "Conflict not found",
  })
  async resolveConflict(
    @Param("conflictId") conflictId: string,
    @Body() resolveDto: ResolveConflictDto,
  ) {
    try {
      const result = await this.conflictResolutionService.resolveConflictById(
        conflictId,
        resolveDto.strategy,
        {
          aiModel: resolveDto.aiModel,
          userReview: resolveDto.userReview,
        },
      );

      return {
        conflictId,
        resolution: {
          strategy: result.strategy,
          confidence: result.confidence,
          reason: result.reason,
          requiresReview: result.needsManualResolution,
          resolvedValue: result.value,
        },
        timestamp: new Date(),
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        throw new NotFoundException(`Conflict ${conflictId} not found`);
      }
      throw error;
    }
  }

  @Post("analyze")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Analyze potential conflicts for given data" })
  @ApiResponse({
    status: 200,
    description: "Conflict analysis completed",
  })
  async analyzeConflict(
    @Body()
    data: {
      userId?: string;
      key: string;
      newValue: string;
      expectedVersion?: number;
      instanceId?: string;
    },
  ) {
    const { key, newValue, expectedVersion } = data;
    const contextUserId = getUserId() || data.userId;
    const contextInstanceId = getInstanceId() || data.instanceId;

    if (!contextUserId) {
      throw new BadRequestException("User ID is required");
    }

    const detection = await this.conflictResolutionService.detectConflict(
      contextUserId,
      key,
      newValue,
      (expectedVersion || 0) + 1,
      expectedVersion,
      contextInstanceId,
    );

    if (!detection.hasConflict) {
      return {
        hasConflict: false,
        message: "No conflicts detected",
      };
    }

    const analysis = this.conflictResolutionService.analyzeConflict(detection.conflictData);

    return {
      hasConflict: true,
      conflictType: analysis.conflictType,
      severity: analysis.severity,
      autoResolvable: analysis.autoResolvable,
      recommendedStrategy: analysis.recommendedStrategy,
      metadata: analysis.metadata,
      conflictData: detection.conflictData,
    };
  }

  @Get("strategies")
  @ApiOperation({ summary: "Get available conflict resolution strategies" })
  @ApiResponse({
    status: 200,
    description: "Available strategies retrieved successfully",
  })
  getAvailableStrategies() {
    const strategies = this.conflictResolutionService.getAvailableStrategies();

    return {
      strategies: strategies.map((strategy) => ({
        id: strategy,
        name: strategy.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
        description: this.getStrategyDescription(strategy),
        confidence: this.getStrategyConfidence(strategy),
        automated: strategy !== ConflictResolutionStrategy.MANUAL,
      })),
      defaultStrategy: ConflictResolutionStrategy.LAST_WRITE_WINS,
    };
  }

  private getStrategyDescription(strategy: ConflictResolutionStrategy): string {
    switch (strategy) {
      case ConflictResolutionStrategy.LAST_WRITE_WINS:
        return "Newer value always takes precedence over older values";
      case ConflictResolutionStrategy.FIRST_WRITE_WINS:
        return "Original value is preserved, ignoring newer updates";
      case ConflictResolutionStrategy.MERGE:
        return "Automatically merge both values when possible";
      case ConflictResolutionStrategy.AI_ASSISTED:
        return "Use AI to intelligently resolve conflicts";
      case ConflictResolutionStrategy.MANUAL:
        return "Mark for human review and manual resolution";
      default:
        return "Unknown strategy";
    }
  }

  private getStrategyConfidence(strategy: ConflictResolutionStrategy): string {
    switch (strategy) {
      case ConflictResolutionStrategy.LAST_WRITE_WINS:
      case ConflictResolutionStrategy.FIRST_WRITE_WINS:
        return "High";
      case ConflictResolutionStrategy.MERGE:
        return "Medium";
      case ConflictResolutionStrategy.AI_ASSISTED:
        return "Very High";
      case ConflictResolutionStrategy.MANUAL:
        return "Perfect (Human Review)";
      default:
        return "Unknown";
    }
  }
}
