import { RemoteStorage } from "./remote-storage";
import type { RemoteStorageConfig, StorageItem, SyncEvent, StorageEventType } from "./types";

// Core exports
export { RemoteStorage };
export type { RemoteStorageConfig, StorageItem, SyncEvent, StorageEventType };

// Factory function
export function createRemoteStorage(config: RemoteStorageConfig) {
  return new RemoteStorage(config);
}
