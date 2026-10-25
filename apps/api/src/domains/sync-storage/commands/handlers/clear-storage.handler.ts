import { CommandHandler, ICommandHandler } from "@nestjs/cqrs";
import { ClearStorageCommand } from "../impl/clear-storage.command";
import { SyncStorageRepository } from "../../repositories/sync-storage.repository";

@CommandHandler(ClearStorageCommand)
export class ClearStorageHandler implements ICommandHandler<ClearStorageCommand> {
  constructor(private readonly repository: SyncStorageRepository) {}

  async execute(command: ClearStorageCommand): Promise<void> {
    const { userId, instanceId } = command;

    await this.repository.clearAll(userId, instanceId);
  }
}
