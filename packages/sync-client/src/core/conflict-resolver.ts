import type { ConflictData } from "../types";
import { ConflictStrategy } from "../types";
import { deepMerge, isObject, isArray } from "../utils/merge";
import { Logger } from "../utils/logger";

/**
 * Advanced conflict resolution system
 */
export class ConflictResolver {
  private logger = new Logger("ConflictResolver");
  private customResolvers = new Map<string, ConflictResolverFunction>();
  private resolutionHistory = new Map<string, ConflictResolution>();

  constructor(private defaultStrategy: ConflictStrategy = ConflictStrategy.LAST_WRITE_WINS) {}

  /**
   * Resolve a conflict using specified strategy
   */
  async resolve<T = any>(
    conflict: ConflictData<T>,
    strategy?: ConflictStrategy,
    customResolver?: ConflictResolverFunction<T>,
  ): Promise<ConflictResolution<T>> {
    const resolveStrategy = strategy || this.defaultStrategy;
    const startTime = Date.now();

    this.logger.debug(`Resolving conflict for key: ${conflict.key}`, {
      strategy: resolveStrategy,
      conflictType: conflict.conflictType,
    });

    let resolution: ConflictResolution<T>;

    try {
      switch (resolveStrategy) {
        case ConflictStrategy.LAST_WRITE_WINS:
          resolution = this.lastWriteWins(conflict);
          break;

        case ConflictStrategy.FIRST_WRITE_WINS:
          resolution = this.firstWriteWins(conflict);
          break;

        case ConflictStrategy.MERGE:
          resolution = this.merge(conflict);
          break;

        case ConflictStrategy.MANUAL:
          if (!customResolver) {
            throw new Error("Manual resolution strategy requires a custom resolver");
          }
          resolution = await this.manual(conflict, customResolver);
          break;

        default:
          throw new Error(`Unknown conflict strategy: ${resolveStrategy}`);
      }

      resolution.resolutionTime = Date.now() - startTime;

      // Store in history
      this.resolutionHistory.set(conflict.id, resolution);

      this.logger.info(`Conflict resolved successfully`, {
        conflictId: conflict.id,
        strategy: resolveStrategy,
        resolutionTime: resolution.resolutionTime,
      });

      return resolution;
    } catch (error) {
      const failureResolution: ConflictResolution<T> = {
        id: conflict.id,
        strategy: resolveStrategy,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        resolvedValue: conflict.localValue, // Fallback to local
        confidence: 0,
        resolutionTime: Date.now() - startTime,
        timestamp: Date.now(),
      };

      this.logger.error(`Conflict resolution failed`, {
        conflictId: conflict.id,
        strategy: resolveStrategy,
        error: error instanceof Error ? error.message : String(error),
      });

      return failureResolution;
    }
  }

  /**
   * Last Write Wins strategy - newest timestamp wins
   */
  private lastWriteWins<T>(conflict: ConflictData<T>): ConflictResolution<T> {
    const useRemote = conflict.remoteTimestamp > conflict.localTimestamp;

    return {
      id: conflict.id,
      strategy: ConflictStrategy.LAST_WRITE_WINS,
      success: true,
      resolvedValue: useRemote ? conflict.remoteValue : conflict.localValue,
      confidence: 1.0,
      metadata: {
        chosenSource: useRemote ? "remote" : "local",
        timeDifference: Math.abs(conflict.remoteTimestamp - conflict.localTimestamp),
      },
      timestamp: Date.now(),
    };
  }

  /**
   * First Write Wins strategy - oldest timestamp wins
   */
  private firstWriteWins<T>(conflict: ConflictData<T>): ConflictResolution<T> {
    const useRemote = conflict.remoteTimestamp < conflict.localTimestamp;

    return {
      id: conflict.id,
      strategy: ConflictStrategy.FIRST_WRITE_WINS,
      success: true,
      resolvedValue: useRemote ? conflict.remoteValue : conflict.localValue,
      confidence: 1.0,
      metadata: {
        chosenSource: useRemote ? "remote" : "local",
        timeDifference: Math.abs(conflict.remoteTimestamp - conflict.localTimestamp),
      },
      timestamp: Date.now(),
    };
  }

  /**
   * Merge strategy - attempt to intelligently merge values
   */
  private merge<T>(conflict: ConflictData<T>): ConflictResolution<T> {
    try {
      const merged = this.intelligentMerge(conflict.localValue, conflict.remoteValue);

      return {
        id: conflict.id,
        strategy: ConflictStrategy.MERGE,
        success: true,
        resolvedValue: merged as T,
        confidence: this.calculateMergeConfidence(conflict),
        metadata: {
          mergeStrategy: this.getMergeStrategy(conflict.localValue, conflict.remoteValue),
          conflictType: conflict.conflictType,
        },
        timestamp: Date.now(),
      };
    } catch (error) {
      // Fall back to last write wins if merge fails
      this.logger.warn(`Merge failed, falling back to last write wins`, { error });
      return this.lastWriteWins(conflict);
    }
  }

  /**
   * Manual strategy - use custom resolver function
   */
  private async manual<T>(
    conflict: ConflictData<T>,
    customResolver: ConflictResolverFunction<T>,
  ): Promise<ConflictResolution<T>> {
    const resolved = await customResolver(conflict);

    return {
      id: conflict.id,
      strategy: ConflictStrategy.MANUAL,
      success: true,
      resolvedValue: resolved,
      confidence: 1.0,
      metadata: {
        resolverType: "custom",
      },
      timestamp: Date.now(),
    };
  }

  /**
   * Intelligent merge based on data types
   */
  private intelligentMerge(local: any, remote: any): any {
    // Handle null/undefined cases
    if (local === null || local === undefined) return remote;
    if (remote === null || remote === undefined) return local;

    // Same values - no conflict
    if (JSON.stringify(local) === JSON.stringify(remote)) {
      return local;
    }

    // Handle primitives - last write wins
    if (typeof local !== "object" || typeof remote !== "object") {
      return remote; // Assume remote is newer
    }

    // Handle arrays
    if (isArray(local) && isArray(remote)) {
      return this.mergeArrays(local, remote);
    }

    // Handle objects
    if (isObject(local) && isObject(remote)) {
      return deepMerge(local, remote);
    }

    // Type mismatch - prefer remote
    return remote;
  }

  /**
   * Merge arrays intelligently
   */
  private mergeArrays(local: any[], remote: any[]): any[] {
    // Simple strategy: combine and deduplicate
    const combined = [...local, ...remote];

    // Remove duplicates based on JSON stringify
    const seen = new Set<string>();
    return combined.filter((item) => {
      const key = JSON.stringify(item);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * Calculate confidence score for merge
   */
  private calculateMergeConfidence(conflict: ConflictData): number {
    let confidence = 0.5; // Base confidence

    // Higher confidence for object merges
    if (isObject(conflict.localValue) && isObject(conflict.remoteValue)) {
      confidence += 0.3;
    }

    // Lower confidence for type mismatches
    if (typeof conflict.localValue !== typeof conflict.remoteValue) {
      confidence -= 0.2;
    }

    // Consider conflict type
    switch (conflict.conflictType) {
      case "version_mismatch":
        confidence += 0.1;
        break;
      case "concurrent_update":
        confidence -= 0.1;
        break;
      case "schema_change":
        confidence -= 0.2;
        break;
    }

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Determine merge strategy based on data types
   */
  private getMergeStrategy(local: any, remote: any): string {
    if (isObject(local) && isObject(remote)) return "deep_merge";
    if (isArray(local) && isArray(remote)) return "array_merge";
    return "overwrite";
  }

  /**
   * Register custom conflict resolver
   */
  registerCustomResolver(name: string, resolver: ConflictResolverFunction): void {
    this.customResolvers.set(name, resolver);
  }

  /**
   * Get conflict resolution history
   */
  getResolutionHistory(): Map<string, ConflictResolution> {
    return new Map(this.resolutionHistory);
  }

  /**
   * Clear resolution history
   */
  clearHistory(): void {
    this.resolutionHistory.clear();
  }

  /**
   * Get resolution statistics
   */
  getStatistics(): ConflictStatistics {
    const resolutions = Array.from(this.resolutionHistory.values());
    const total = resolutions.length;

    if (total === 0) {
      return {
        totalConflicts: 0,
        successRate: 0,
        averageResolutionTime: 0,
        strategyDistribution: {},
        averageConfidence: 0,
      };
    }

    const successful = resolutions.filter((r) => r.success).length;
    const totalTime = resolutions.reduce((sum, r) => sum + (r.resolutionTime || 0), 0);
    const totalConfidence = resolutions.reduce((sum, r) => sum + r.confidence, 0);

    const strategyDistribution: Record<string, number> = {};
    resolutions.forEach((r) => {
      strategyDistribution[r.strategy] = (strategyDistribution[r.strategy] || 0) + 1;
    });

    return {
      totalConflicts: total,
      successRate: successful / total,
      averageResolutionTime: totalTime / total,
      strategyDistribution,
      averageConfidence: totalConfidence / total,
    };
  }
}

// Types
export type ConflictResolverFunction<T = any> = (conflict: ConflictData<T>) => Promise<T> | T;

export interface ConflictResolution<T = any> {
  id: string;
  strategy: ConflictStrategy;
  success: boolean;
  resolvedValue?: T;
  confidence: number;
  error?: string;
  metadata?: Record<string, any>;
  resolutionTime?: number;
  timestamp: number;
}

interface ConflictStatistics {
  totalConflicts: number;
  successRate: number;
  averageResolutionTime: number;
  strategyDistribution: Record<string, number>;
  averageConfidence: number;
}
