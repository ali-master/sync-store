import { EventsHandler, IEventHandler } from "@nestjs/cqrs";
import { Logger } from "@nestjs/common";
import { ItemRemovedEvent } from "../impl/item-removed.event";
import { SyncQueueService } from "../../services/sync-queue.service";

@EventsHandler(ItemRemovedEvent)
export class ItemRemovedHandler implements IEventHandler<ItemRemovedEvent> {
  private readonly logger = new Logger(ItemRemovedHandler.name);

  constructor(private readonly syncQueueService: SyncQueueService) {}

  async handle(event: ItemRemovedEvent): Promise<void> {
    this.logger.log(`Item removed: ${event.key} for user ${event.userId}`);

    await this.syncQueueService.queueRemoval(event);
  }
}
