import { EventsHandler, IEventHandler } from "@nestjs/cqrs";
import { Logger } from "@nestjs/common";
import { StorageClearedEvent } from "../impl/storage-cleared.event";
import { SyncQueueService } from "../../services/sync-queue.service";

@EventsHandler(StorageClearedEvent)
export class StorageClearedHandler implements IEventHandler<StorageClearedEvent> {
  private readonly logger = new Logger(StorageClearedHandler.name);

  constructor(private readonly syncQueueService: SyncQueueService) {}

  async handle(event: StorageClearedEvent): Promise<void> {
    this.logger.log(`Storage cleared for user ${event.userId}`);

    await this.syncQueueService.clearQueue(event.userId);
  }
}
