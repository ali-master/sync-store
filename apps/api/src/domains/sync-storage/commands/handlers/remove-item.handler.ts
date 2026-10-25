import { CommandHandler, ICommandHandler } from "@nestjs/cqrs";
import { RemoveItemCommand } from "../impl/remove-item.command";
import { SyncStorageRepository } from "../../repositories/sync-storage.repository";

@CommandHandler(RemoveItemCommand)
export class RemoveItemHandler implements ICommandHandler<RemoveItemCommand> {
  constructor(private readonly repository: SyncStorageRepository) {}

  async execute(command: RemoveItemCommand): Promise<void> {
    const { userId, instanceId, key } = command;

    await this.repository.delete(userId, key, instanceId);
  }
}
