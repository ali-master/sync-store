import { ItemSyncedHandler } from "./item-synced.handler";
import { ItemRemovedHandler } from "./item-removed.handler";
import { StorageClearedHandler } from "./storage-cleared.handler";

export const EventHandlers = [ItemSyncedHandler, ItemRemovedHandler, StorageClearedHandler];
