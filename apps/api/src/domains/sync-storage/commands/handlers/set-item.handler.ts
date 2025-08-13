import { CommandHandler, ICommandHandler, EventBus } from "@nestjs/cqrs";
import { Logger } from "@nestjs/common";
import { SetItemCommand } from "../impl/set-item.command";
import { SyncStorageRepository } from "../../repositories/sync-storage.repository";
import {
  ConflictResolutionService,
  ConflictResolutionStrategy,
} from "../../services/conflict-resolution.service";
import { ItemSyncedEvent } from "../../events/impl/item-synced.event";
import { StorageItem } from "../../entities/storage-item.entity";

@CommandHandler(SetItemCommand)
export class SetItemHandler implements ICommandHandler<SetItemCommand> {
  private readonly logger = new Logger(SetItemHandler.name);

  constructor(
    private readonly repository: SyncStorageRepository,
    private readonly conflictResolution: ConflictResolutionService,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: SetItemCommand): Promise<StorageItem> {
    const { userId, instanceId, key, value, metadata } = command;

    const existingItem = await this.repository.findByKey(userId, key);

    let resolvedValue = value;
    let resolvedMetadata = metadata;
    let version = 1;
    let conflictDetected = false;

    if (existingItem) {
      version = existingItem.version + 1;

      // conflict detection
      const conflictCheck = await this.conflictResolution.detectConflict(
        userId,
        key,
        JSON.stringify(value),
        version,
        existingItem.version,
        instanceId,
      );

      if (conflictCheck.hasConflict) {
        conflictDetected = true;
        this.logger.warn(
          `Conflict detected for user ${userId}, key ${key}: ${conflictCheck.conflictData.type}`,
        );

        // Create conflict record
        const conflictRecord = await this.conflictResolution.createConflict(
          existingItem.id || `${userId}:${key}`,
          userId,
          conflictCheck.conflictData,
          ConflictResolutionStrategy.LAST_WRITE_WINS, // Default strategy
        );

        this.logger.log(`Created conflict record ${conflictRecord.id}`);
      }

      // Resolve conflict using existing logic (backward compatibility)
      const resolution = await this.conflictResolution.resolve(existingItem, {
        value,
        metadata,
        timestamp: Date.now(),
        version,
        instanceId,
      });

      resolvedValue = resolution.value;
      resolvedMetadata = resolution.metadata;

      if (resolution.needsManualResolution) {
        this.logger.warn(`Manual resolution required for user ${userId}, key ${key}`);
      }

      if (resolution.confidence && resolution.confidence < 0.5) {
        this.logger.warn(
          `Low confidence resolution (${resolution.confidence}) for user ${userId}, key ${key}`,
        );
      }
    }

    const item = await this.repository.upsert({
      userId,
      instanceId,
      key,
      value: resolvedValue,
      metadata: resolvedMetadata,
      version,
      timestamp: Date.now(),
      lastModified: new Date(),
    });

    // event with conflict information
    this.eventBus.publish(
      new ItemSyncedEvent(userId, instanceId, key, resolvedValue, {
        ...resolvedMetadata,
        conflictDetected,
        version,
        resolvedAt: new Date().toISOString(),
      }),
    );

    this.logger.debug(
      `Set item for user ${userId}, key ${key}, version ${version}${conflictDetected ? " (conflict resolved)" : ""}`,
    );

    return item;
  }
}
