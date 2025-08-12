import { CommandHandler, ICommandHandler, EventBus } from "@nestjs/cqrs";
import { RemoveItemCommand } from "../impl/remove-item.command";
import { SyncStorageRepository } from "../../repositories/sync-storage.repository";
import { ItemRemovedEvent } from "../../events/impl/item-removed.event";

@CommandHandler(RemoveItemCommand)
export class RemoveItemHandler implements ICommandHandler<RemoveItemCommand> {
  constructor(
    private readonly repository: SyncStorageRepository,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: RemoveItemCommand): Promise<void> {
    const { userId, instanceId, key } = command;

    await this.repository.delete(userId, key);

    this.eventBus.publish(new ItemRemovedEvent(userId, instanceId, key));
  }
}
