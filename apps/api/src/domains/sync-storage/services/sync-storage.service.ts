import { Injectable, Logger } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { SetItemCommand } from "../commands/impl/set-item.command";
import { RemoveItemCommand } from "../commands/impl/remove-item.command";
import { ClearStorageCommand } from "../commands/impl/clear-storage.command";
import { GetItemQuery } from "../queries/impl/get-item.query";
import { GetAllItemsQuery } from "../queries/impl/get-all-items.query";
import { GetKeysQuery } from "../queries/impl/get-keys.query";
import { StorageItem } from "../entities/storage-item.entity";

@Injectable()
export class SyncStorageService {
  private readonly logger = new Logger(SyncStorageService.name);

  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  async setItem(
    userId: string,
    instanceId: string,
    key: string,
    value: any,
    metadata?: Record<string, any>,
  ): Promise<StorageItem> {
    this.logger.debug(`Setting item ${key} for user ${userId}`);

    const command = new SetItemCommand(userId, instanceId, key, value, metadata);
    return await this.commandBus.execute(command);
  }

  async getItem(userId: string, instanceId: string, key: string): Promise<StorageItem | null> {
    this.logger.debug(`Getting item ${key} for user ${userId}`);

    const query = new GetItemQuery(userId, instanceId, key);
    return await this.queryBus.execute(query);
  }

  async removeItem(userId: string, instanceId: string, key: string): Promise<void> {
    this.logger.debug(`Removing item ${key} for user ${userId}`);

    const command = new RemoveItemCommand(userId, instanceId, key);
    await this.commandBus.execute(command);
  }

  async getAllItems(userId: string, instanceId: string, prefix?: string): Promise<StorageItem[]> {
    this.logger.debug(`Getting all items for user ${userId}`);

    const query = new GetAllItemsQuery(userId, instanceId, prefix);
    return await this.queryBus.execute(query);
  }

  async getKeys(userId: string, instanceId: string, prefix?: string): Promise<string[]> {
    this.logger.debug(`Getting keys for user ${userId}`);

    const query = new GetKeysQuery(userId, instanceId, prefix);
    return await this.queryBus.execute(query);
  }

  async clear(userId: string, instanceId: string): Promise<void> {
    this.logger.debug(`Clearing storage for user ${userId}`);

    const command = new ClearStorageCommand(userId, instanceId);
    await this.commandBus.execute(command);
  }

  async exists(userId: string, instanceId: string, key: string): Promise<boolean> {
    const item = await this.getItem(userId, instanceId, key);
    return item !== null && !item.isDeleted;
  }

  async length(userId: string, instanceId: string): Promise<number> {
    const items = await this.getAllItems(userId, instanceId);
    return items.filter((item) => !item.isDeleted).length;
  }
}
