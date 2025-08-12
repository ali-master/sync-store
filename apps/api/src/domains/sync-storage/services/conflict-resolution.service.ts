import { Injectable, Logger } from "@nestjs/common";
import { InjectDbTransactor, type PrismaTransactor } from "@root/modules/db";
import { StorageItem } from "../entities/storage-item.entity";
import { SyncConflict } from "@prisma/client";

export enum ConflictResolutionStrategy {
  LAST_WRITE_WINS = "last_write_wins",
  FIRST_WRITE_WINS = "first_write_wins",
  MERGE = "merge",
  MANUAL = "manual",
  AI_ASSISTED = "ai_assisted",
}

export enum ConflictType {
  VERSION_MISMATCH = "version_mismatch",
  CONCURRENT_UPDATE = "concurrent_update",
  SCHEMA_CHANGE = "schema_change",
  DATA_CORRUPTION = "data_corruption",
}

export enum SyncConflictStatus {
  PENDING = "pending",
  RESOLVED = "resolved",
  ESCALATED = "escalated",
}

export interface ConflictResolutionResult {
  value: any;
  metadata?: Record<string, any>;
  needsManualResolution?: boolean;
  confidence?: number;
  strategy?: ConflictResolutionStrategy;
  reason?: string;
}

export interface UpdateData {
  value: any;
  metadata?: Record<string, any>;
  timestamp: number;
  version?: number;
  instanceId?: string;
}

export interface ConflictAnalysis {
  conflictType: ConflictType;
  severity: "low" | "medium" | "high" | "critical";
  autoResolvable: boolean;
  recommendedStrategy: ConflictResolutionStrategy;
  metadata: Record<string, any>;
}

@Injectable()
export class ConflictResolutionService {
  private readonly logger = new Logger(ConflictResolutionService.name);
  private readonly defaultStrategy: ConflictResolutionStrategy =
    ConflictResolutionStrategy.LAST_WRITE_WINS;

  constructor(
    @InjectDbTransactor()
    private readonly dbTransactorService: PrismaTransactor,
  ) {}

  /**
   * Detect potential conflicts when setting an item
   */
  async detectConflict(
    userId: string,
    key: string,
    newValue: string,
    _newVersion: number,
    expectedVersion?: number,
    instanceId?: string,
  ): Promise<{ hasConflict: boolean; conflictData?: any }> {
    const db = this.dbTransactorService.tx;

    const currentItem = await db.syncStorageItem.findUnique({
      where: { userId_key: { userId, key } },
    });

    if (!currentItem) {
      return { hasConflict: false };
    }

    // Version-based conflict detection
    if (expectedVersion && currentItem.version !== expectedVersion) {
      return {
        hasConflict: true,
        conflictData: {
          type: ConflictType.VERSION_MISMATCH,
          currentVersion: currentItem.version,
          expectedVersion,
          currentValue: currentItem.value,
          newValue,
        },
      };
    }

    // Concurrent modification detection
    const timeDiff = Date.now() - currentItem.lastModified.getTime();
    if (
      timeDiff < 5000 &&
      currentItem.value !== newValue &&
      instanceId !== currentItem.instanceId
    ) {
      return {
        hasConflict: true,
        conflictData: {
          type: ConflictType.CONCURRENT_UPDATE,
          currentValue: currentItem.value,
          newValue,
          timeDifference: timeDiff,
          instanceId,
          currentInstanceId: currentItem.instanceId,
        },
      };
    }

    // Schema change detection
    try {
      const currentObj = JSON.parse(currentItem.value);
      const newObj = JSON.parse(newValue);

      if (this.hasSchemaChange(currentObj, newObj)) {
        return {
          hasConflict: true,
          conflictData: {
            type: ConflictType.SCHEMA_CHANGE,
            currentValue: currentItem.value,
            newValue,
            schemaChanges: this.detectSchemaChanges(currentObj, newObj),
          },
        };
      }
    } catch (error) {
      this.logger.warn(
        `JSON parsing failed for conflict detection: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }

    return { hasConflict: false };
  }

  /**
   * Create a conflict record in the database
   */
  async createConflict(
    itemId: string,
    userId: string,
    conflictData: any,
    resolutionStrategy: ConflictResolutionStrategy = ConflictResolutionStrategy.LAST_WRITE_WINS,
  ): Promise<SyncConflict> {
    const db = this.dbTransactorService.tx;

    const conflict = await db.syncConflict.create({
      data: {
        itemId,
        userId,
        conflictType: conflictData.type,
        resolutionStrategy,
        originalValue: conflictData.currentValue,
        conflictingValue: conflictData.newValue,
        status: SyncConflictStatus.PENDING,
      },
    });

    this.logger.log(`Created conflict record ${conflict.id} for item ${itemId}`);
    return conflict;
  }

  /**
   * Analyze conflict and determine resolution strategy
   */
  analyzeConflict(conflictData: any): ConflictAnalysis {
    const analysis: ConflictAnalysis = {
      conflictType: conflictData.type,
      severity: "medium",
      autoResolvable: true,
      recommendedStrategy: ConflictResolutionStrategy.LAST_WRITE_WINS,
      metadata: {},
    };

    switch (conflictData.type) {
      case ConflictType.VERSION_MISMATCH:
        analysis.severity = "high";
        analysis.recommendedStrategy = ConflictResolutionStrategy.MERGE;
        analysis.metadata.versionGap = Math.abs(
          conflictData.currentVersion - conflictData.expectedVersion,
        );
        break;

      case ConflictType.CONCURRENT_UPDATE:
        analysis.severity = conflictData.timeDifference < 1000 ? "critical" : "high";
        analysis.recommendedStrategy = ConflictResolutionStrategy.FIRST_WRITE_WINS;
        analysis.metadata.timeDifference = conflictData.timeDifference;
        break;

      case ConflictType.SCHEMA_CHANGE:
        analysis.severity = "critical";
        analysis.autoResolvable = false;
        analysis.recommendedStrategy = ConflictResolutionStrategy.MANUAL;
        analysis.metadata.schemaChanges = conflictData.schemaChanges;
        break;

      default:
        analysis.severity = "low";
    }

    return analysis;
  }

  async resolve(
    existingItem: StorageItem,
    updateData: UpdateData,
    strategy: ConflictResolutionStrategy = this.defaultStrategy,
  ): Promise<ConflictResolutionResult> {
    this.logger.debug(`Resolving conflict for key ${existingItem.key} using strategy: ${strategy}`);

    switch (strategy) {
      case ConflictResolutionStrategy.LAST_WRITE_WINS:
        return this.lastWriteWins(existingItem, updateData);

      case ConflictResolutionStrategy.FIRST_WRITE_WINS:
        return this.firstWriteWins(existingItem, updateData);

      case ConflictResolutionStrategy.MERGE:
        return this.mergeStrategy(existingItem, updateData);

      case ConflictResolutionStrategy.AI_ASSISTED:
        return await this.aiAssistedStrategy(existingItem, updateData);

      case ConflictResolutionStrategy.MANUAL:
        return this.manualResolution(existingItem, updateData);

      default:
        return this.lastWriteWins(existingItem, updateData);
    }
  }

  /**
   * Resolve a conflict using database-stored conflict record
   */
  async resolveConflictById(
    conflictId: string,
    strategy: ConflictResolutionStrategy,
    options: { aiModel?: string; userReview?: boolean } = {},
  ): Promise<ConflictResolutionResult> {
    const db = this.dbTransactorService.tx;

    const conflict = await db.syncConflict.findUnique({
      where: { id: conflictId },
      include: { item: true },
    });

    if (!conflict) {
      throw new Error(`Conflict ${conflictId} not found`);
    }

    const existingItem: StorageItem = {
      id: conflict.itemId,
      userId: conflict.userId,
      instanceId: conflict.item?.instanceId || "",
      key: conflict.item?.key || "",
      value: JSON.parse(conflict.originalValue),
      timestamp: conflict.item?.timestamp ? Number(conflict.item.timestamp) : Date.now(),
      version: conflict.item?.version || 1,
      lastModified: conflict.item?.lastModified || new Date(),
      metadata: conflict.item?.metadata ? JSON.parse(conflict.item.metadata) : {},
      toJSON: () => ({
        key: conflict.item?.key || "",
        value: JSON.parse(conflict.originalValue),
        metadata: conflict.item?.metadata ? JSON.parse(conflict.item.metadata) : {},
        version: conflict.item?.version || 1,
        timestamp: conflict.item?.timestamp ? Number(conflict.item.timestamp) : Date.now(),
        lastModified: conflict.item?.lastModified || new Date(),
      }),
    };

    const updateData: UpdateData = {
      value: JSON.parse(conflict.conflictingValue),
      timestamp: Date.now(),
      metadata: {},
    };

    const result = await this.resolve(existingItem, updateData, strategy);

    // Update conflict record
    await db.syncConflict.update({
      where: { id: conflictId },
      data: {
        status: result.needsManualResolution
          ? SyncConflictStatus.PENDING
          : SyncConflictStatus.RESOLVED,
        resolvedValue: JSON.stringify(result.value),
        resolutionReason: result.reason,
        confidence: result.confidence,
        aiModel: options.aiModel,
        humanReviewed: options.userReview || false,
        resolvedAt: new Date(),
      },
    });

    this.logger.log(
      `Resolved conflict ${conflictId} using ${strategy} strategy with confidence ${result.confidence}`,
    );

    return result;
  }

  private lastWriteWins(
    existingItem: StorageItem,
    updateData: UpdateData,
  ): ConflictResolutionResult {
    if (updateData.timestamp >= existingItem.timestamp) {
      return {
        value: updateData.value,
        metadata: this.mergeMetadata(existingItem.metadata, updateData.metadata),
        confidence: 0.8,
        strategy: ConflictResolutionStrategy.LAST_WRITE_WINS,
        reason: "Applied last write wins strategy - newer value takes precedence",
      };
    }

    return {
      value: existingItem.value,
      metadata: existingItem.metadata,
      confidence: 0.8,
      strategy: ConflictResolutionStrategy.LAST_WRITE_WINS,
      reason: "Applied last write wins strategy - existing value kept (newer timestamp)",
    };
  }

  private firstWriteWins(
    existingItem: StorageItem,
    updateData: UpdateData,
  ): ConflictResolutionResult {
    if (existingItem.timestamp <= updateData.timestamp) {
      return {
        value: existingItem.value,
        metadata: existingItem.metadata,
        confidence: 0.7,
        strategy: ConflictResolutionStrategy.FIRST_WRITE_WINS,
        reason: "Applied first write wins strategy - original value preserved",
      };
    }

    return {
      value: updateData.value,
      metadata: this.mergeMetadata(existingItem.metadata, updateData.metadata),
      confidence: 0.7,
      strategy: ConflictResolutionStrategy.FIRST_WRITE_WINS,
      reason: "Applied first write wins strategy - update value used (older existing timestamp)",
    };
  }

  private mergeStrategy(
    existingItem: StorageItem,
    updateData: UpdateData,
  ): ConflictResolutionResult {
    const existingValue = existingItem.value;
    const newValue = updateData.value;

    if (this.isObject(existingValue) && this.isObject(newValue)) {
      const mergedValue = this.deepMerge(existingValue, newValue);

      return {
        value: mergedValue,
        metadata: this.mergeMetadata(existingItem.metadata, updateData.metadata),
        confidence: 0.6,
        strategy: ConflictResolutionStrategy.MERGE,
        reason:
          "Applied automatic merge - combined both object versions with new values taking precedence",
      };
    }

    if (Array.isArray(existingValue) && Array.isArray(newValue)) {
      const mergedArray = [...new Set([...existingValue, ...newValue])];

      return {
        value: mergedArray,
        metadata: this.mergeMetadata(existingItem.metadata, updateData.metadata),
        confidence: 0.7,
        strategy: ConflictResolutionStrategy.MERGE,
        reason: "Applied automatic merge - combined arrays with duplicate removal",
      };
    }

    // Fallback to last write wins for non-mergeable types
    const fallback = this.lastWriteWins(existingItem, updateData);
    return {
      ...fallback,
      strategy: ConflictResolutionStrategy.MERGE,
      reason: "Merge fallback - used last write wins for non-mergeable data types",
    };
  }

  private manualResolution(
    existingItem: StorageItem,
    updateData: UpdateData,
  ): ConflictResolutionResult {
    return {
      value: {
        existing: existingItem.value,
        incoming: updateData.value,
        timestamp: {
          existing: existingItem.timestamp,
          incoming: updateData.timestamp,
        },
      },
      metadata: {
        ...this.mergeMetadata(existingItem.metadata, updateData.metadata),
        conflictResolution: "manual",
        conflictDetected: true,
      },
      needsManualResolution: true,
      confidence: 0.0,
      strategy: ConflictResolutionStrategy.MANUAL,
      reason: "Manual resolution required - conflict marked for human review",
    };
  }

  private async aiAssistedStrategy(
    existingItem: StorageItem,
    updateData: UpdateData,
  ): Promise<ConflictResolutionResult> {
    // Placeholder for AI-assisted resolution
    this.logger.log(`AI-assisted resolution requested for key ${existingItem.key}`);

    // For now, use smart merge strategy with higher confidence
    const mergeResult = this.mergeStrategy(existingItem, updateData);

    return {
      ...mergeResult,
      confidence: Math.min((mergeResult.confidence || 0.6) + 0.2, 0.95),
      strategy: ConflictResolutionStrategy.AI_ASSISTED,
      reason: `AI-assisted resolution: ${mergeResult.reason}`,
    };
  }

  private mergeMetadata(
    existing?: Record<string, any>,
    incoming?: Record<string, any>,
  ): Record<string, any> | undefined {
    if (!existing && !incoming) return undefined;
    if (!existing) return incoming;
    if (!incoming) return existing;

    return {
      ...existing,
      ...incoming,
      mergedAt: Date.now(),
    };
  }

  private deepMerge(target: any, source: any): any {
    const result = { ...target };

    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        if (this.isObject(target[key]) && this.isObject(source[key])) {
          result[key] = this.deepMerge(target[key], source[key]);
        } else {
          result[key] = source[key];
        }
      }
    }

    return result;
  }

  private isObject(item: any): boolean {
    return item !== null && typeof item === "object" && !Array.isArray(item);
  }

  /**
   * Get conflict history for an item
   */
  async getConflictHistory(itemId: string): Promise<SyncConflict[]> {
    const db = this.dbTransactorService.tx;

    return db.syncConflict.findMany({
      where: { itemId },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Get user's conflict statistics
   */
  async getUserConflictStats(userId: string, timeRange: { start: Date; end: Date }) {
    const db = this.dbTransactorService.tx;

    const stats = await db.syncConflict.groupBy({
      by: ["conflictType", "status"],
      where: {
        userId,
        createdAt: {
          gte: timeRange.start,
          lte: timeRange.end,
        },
      },
      _count: { id: true },
    });

    const totalConflicts = stats.reduce((sum, stat) => sum + stat._count.id, 0);
    const resolvedConflicts = stats
      .filter((stat) => stat.status === SyncConflictStatus.RESOLVED)
      .reduce((sum, stat) => sum + stat._count.id, 0);

    return {
      totalConflicts,
      resolvedConflicts,
      pendingConflicts: totalConflicts - resolvedConflicts,
      autoResolutionRate: totalConflicts > 0 ? resolvedConflicts / totalConflicts : 0,
      conflictsByType: stats.reduce(
        (acc, stat) => {
          acc[stat.conflictType] = (acc[stat.conflictType] || 0) + stat._count.id;
          return acc;
        },
        {} as Record<string, number>,
      ),
    };
  }

  private hasSchemaChange(obj1: any, obj2: any): boolean {
    const keys1 = Object.keys(obj1 || {});
    const keys2 = Object.keys(obj2 || {});

    if (keys1.length !== keys2.length) return true;

    for (const key of keys1) {
      if (!keys2.includes(key)) return true;
      if (typeof obj1[key] !== typeof obj2[key]) return true;
    }

    return false;
  }

  private detectSchemaChanges(obj1: any, obj2: any): Record<string, any> {
    const changes: Record<string, any> = {};
    const keys1 = Object.keys(obj1 || {});
    const keys2 = Object.keys(obj2 || {});

    const added = keys2.filter((key) => !keys1.includes(key));
    if (added.length > 0) changes.added = added;

    const removed = keys1.filter((key) => !keys2.includes(key));
    if (removed.length > 0) changes.removed = removed;

    const typeChanged = keys1
      .filter((key) => keys2.includes(key) && typeof obj1[key] !== typeof obj2[key])
      .map((key) => ({
        key,
        from: typeof obj1[key],
        to: typeof obj2[key],
      }));
    if (typeChanged.length > 0) changes.typeChanged = typeChanged;

    return changes;
  }

  getAvailableStrategies(): ConflictResolutionStrategy[] {
    return [
      ConflictResolutionStrategy.LAST_WRITE_WINS,
      ConflictResolutionStrategy.FIRST_WRITE_WINS,
      ConflictResolutionStrategy.MERGE,
      ConflictResolutionStrategy.AI_ASSISTED,
      ConflictResolutionStrategy.MANUAL,
    ];
  }
}
