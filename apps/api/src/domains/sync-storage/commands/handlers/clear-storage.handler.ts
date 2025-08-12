import { CommandHandler, ICommandHandler, EventBus } from "@nestjs/cqrs";
import { ClearStorageCommand } from "../impl/clear-storage.command";
import { SyncStorageRepository } from "../../repositories/sync-storage.repository";
import { StorageClearedEvent } from "../../events/impl/storage-cleared.event";

@CommandHandler(ClearStorageCommand)
export class ClearStorageHandler implements ICommandHandler<ClearStorageCommand> {
  constructor(
    private readonly repository: SyncStorageRepository,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: ClearStorageCommand): Promise<void> {
    const { userId, instanceId } = command;

    await this.repository.clearAll(userId);

    this.eventBus.publish(new StorageClearedEvent(userId, instanceId));
  }
}
