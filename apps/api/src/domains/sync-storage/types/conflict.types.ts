export enum ConflictType {
  VERSION_MISMATCH = "version_mismatch",
  CONCURRENT_UPDATE = "concurrent_update",
  SCHEMA_CHANGE = "schema_change",
  DATA_CORRUPTION = "data_corruption",
  PERMISSION_CHANGE = "permission_change",
}

export enum ConflictResolutionStrategy {
  LAST_WRITE_WINS = "last_write_wins",
  FIRST_WRITE_WINS = "first_write_wins",
  MERGE = "merge",
  MANUAL = "manual",
  AI_ASSISTED = "ai_assisted",
}

export enum SyncConflictStatus {
  PENDING = "pending",
  RESOLVED = "resolved",
  ESCALATED = "escalated",
  IGNORED = "ignored",
}

export interface ConflictResolutionOptions {
  strategy: ConflictResolutionStrategy;
  aiModel?: string;
  mergePreferences?: {
    prioritizeLocal?: boolean;
    preserveArrays?: boolean;
    conflictMarkers?: boolean;
  };
  userReview?: boolean;
  timeout?: number;
}

export interface ConflictMetadata {
  detectedAt: Date;
  resolutionAttempts: number;
  lastResolutionAttempt?: Date;
  userInvolved: boolean;
  systemGenerated: boolean;
  tags?: string[];
}
