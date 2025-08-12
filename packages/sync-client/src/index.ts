import { RemoteStorage } from "./remote-storage";
import type { RemoteStorageConfig, StorageItem, SyncEvent, StorageEventType } from "./types";

export { RemoteStorage };
export type { RemoteStorageConfig, StorageItem, SyncEvent, StorageEventType };

export { useRemoteStorage, useStorageItem, useStorageKeys, useStorageLength } from "./react-hooks";

export type { UseRemoteStorageOptions } from "./react-hooks";

export function createRemoteStorage(config: RemoteStorageConfig) {
  return new RemoteStorage(config);
}
