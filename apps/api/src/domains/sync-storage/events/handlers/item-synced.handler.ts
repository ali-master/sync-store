import { EventsHandler, IEventHandler } from "@nestjs/cqrs";
import { Logger } from "@nestjs/common";
import { ItemSyncedEvent } from "../impl/item-synced.event";
import { SyncQueueService } from "../../services/sync-queue.service";

@EventsHandler(ItemSyncedEvent)
export class ItemSyncedHandler implements IEventHandler<ItemSyncedEvent> {
  private readonly logger = new Logger(ItemSyncedHandler.name);

  constructor(private readonly syncQueueService: SyncQueueService) {}

  async handle(event: ItemSyncedEvent): Promise<void> {
    this.logger.log(`Item synced: ${event.key} for user ${event.userId}`);

    await this.syncQueueService.queueUpdate(event);
  }
}
