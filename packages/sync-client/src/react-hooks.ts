import { useEffect, useState, useCallback, useMemo } from "react";
import type {
  RemoteStorageConfig,
  StorageItem,
  ConnectionInfo,
  SyncEvent,
  BatchOperation,
  BatchResult,
  ChangeEvent,
  ConflictData,
  NetworkChangeEvent,
  SyncFilter,
} from "./types";
import { ConnectionState } from "./types";
import { RemoteStorage } from "./remote-storage";

/**
 * Hook configuration options
 */
export interface UseSyncStoreOptions {
  config: RemoteStorageConfig;
  autoConnect?: boolean;
  subscribeToKeys?: string[];
  syncFilter?: SyncFilter;
}

/**
 * Return type for useSyncStore hook
 */
export interface SyncStoreHookResult {
  // Core storage methods
  getItem: (key: string) => any;
  setItem: (key: string, value: any, metadata?: Record<string, any>) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
  clear: () => void;
  getAllKeys: () => string[];
  getAllItems: () => Promise<StorageItem[]>;

  // Batch operations
  executeBatch: (operations: BatchOperation[]) => Promise<BatchResult>;

  // Connection management
  connect: () => Promise<void>;
  disconnect: () => void;
  isConnected: boolean;
  connectionInfo: ConnectionInfo;

  // Subscription management
  subscribe: (keys: string[]) => Promise<void>;
  unsubscribe: (keys: string[]) => Promise<void>;
  setSyncFilter: (filter: SyncFilter) => void;

  // Sync operations
  forceSync: () => Promise<void>;
  waitForConnection: (timeout?: number) => Promise<void>;

  // State
  storage: RemoteStorage;
  isLoading: boolean;
  error: Error | null;

  // Analytics
  getAnalytics: () => any;
}

/**
 * Main hook for using sync storage with React
 */
export function useSyncStore(options: UseSyncStoreOptions): SyncStoreHookResult {
  const { config, autoConnect = true, subscribeToKeys = [], syncFilter } = options;

  // Create storage instance (only once) - use stable config reference
  const storage = useMemo(
    () => new RemoteStorage(config),
    [config.userId, config.serverUrl, config.instanceId],
  );

  // State
  const [isConnected, setIsConnected] = useState(false);
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo>({
    state: ConnectionState.DISCONNECTED,
    reconnectAttempts: 0,
  });
  const [isLoading, setIsLoading] = useState(autoConnect);
  const [error, setError] = useState<Error | null>(null);

  // Setup event listeners
  useEffect(() => {
    const handleConnect = () => {
      setIsConnected(true);
      setIsLoading(false);
      setError(null);
      setConnectionInfo(storage.getConnectionInfo());
    };

    const handleDisconnect = () => {
      setIsConnected(false);
      setConnectionInfo(storage.getConnectionInfo());
    };

    const handleError = ({ error: err }: { type: string; message: string; error: any }) => {
      setError(err instanceof Error ? err : new Error(err.message || "Unknown error"));
      setIsLoading(false);
    };

    const handleNetworkChange = ({ state }: NetworkChangeEvent) => {
      setConnectionInfo((prev) => ({ ...prev, state }));
    };

    storage.on("connect", handleConnect);
    storage.on("disconnect", handleDisconnect);
    storage.on("error", handleError);
    storage.on("network-change", handleNetworkChange);

    return () => {
      storage.off("connect", handleConnect);
      storage.off("disconnect", handleDisconnect);
      storage.off("error", handleError);
      storage.off("network-change", handleNetworkChange);
    };
  }, [storage]);

  // Auto-connect on mount
  useEffect(() => {
    let cancelled = false;

    if (autoConnect && !storage.isConnected()) {
      storage.connect().catch((err) => {
        if (!cancelled) {
          setError(err);
          setIsLoading(false);
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [storage, autoConnect]);

  // Auto-subscribe to keys
  useEffect(() => {
    if (subscribeToKeys.length > 0) {
      storage.subscribe(subscribeToKeys).catch((err) => {
        console.warn("Failed to subscribe to keys:", err);
      });
    }

    return () => {
      if (subscribeToKeys.length > 0) {
        storage.unsubscribe(subscribeToKeys).catch((err) => {
          console.warn("Failed to unsubscribe from keys:", err);
        });
      }
    };
  }, [storage, subscribeToKeys]);

  // Set sync filter
  useEffect(() => {
    if (syncFilter) {
      storage.setSyncFilter(syncFilter);
    }
  }, [storage, syncFilter]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Disconnect properly before destroy to avoid lingering connections
      if (storage.isConnected()) {
        storage.disconnect();
      }
      storage.destroy();
    };
  }, [storage]);

  // Memoized methods
  const methods = useMemo(
    () => ({
      getItem: (key: string) => storage.getItem(key),
      setItem: (key: string, value: any, metadata?: Record<string, any>) =>
        storage.setItem(key, value, metadata),
      removeItem: (key: string) => storage.removeItem(key),
      clear: () => storage.clear(),
      getAllKeys: () => storage.getAllKeys(),
      getAllItems: () => storage.getAllItems(),
      executeBatch: (operations: BatchOperation[]) => storage.executeBatch(operations),
      connect: () => storage.connect(),
      disconnect: () => storage.disconnect(),
      subscribe: (keys: string[]) => storage.subscribe(keys),
      unsubscribe: (keys: string[]) => storage.unsubscribe(keys),
      setSyncFilter: (filter: SyncFilter) => storage.setSyncFilter(filter),
      forceSync: () => storage.forceSync(),
      waitForConnection: (timeout?: number) => storage.waitForConnection(timeout),
      getAnalytics: () => storage.getAnalytics(),
    }),
    [storage],
  );

  return {
    ...methods,
    storage,
    isConnected,
    connectionInfo,
    isLoading,
    error,
  };
}

/**
 * Hook for reactive storage values
 */
export function useSyncValue<T = any>(
  storage: RemoteStorage,
  key: string,
  defaultValue?: T,
): [T | undefined, (value: T, metadata?: Record<string, any>) => Promise<void>] {
  const [value, setValue] = useState<T | undefined>(() => storage.getItem(key) ?? defaultValue);

  // Update value when storage changes
  useEffect(() => {
    const handleChange = (event: ChangeEvent) => {
      if (event.key === key) {
        setValue(event.newValue ?? defaultValue);
      }
    };

    storage.on("change", handleChange);

    // Set initial value
    const initialValue = storage.getItem(key);
    if (initialValue !== null) {
      setValue(initialValue);
    }

    return () => {
      storage.off("change", handleChange);
    };
  }, [storage, key, defaultValue]);

  const updateValue = useCallback(
    async (newValue: T, metadata?: Record<string, any>) => {
      await storage.setItem(key, newValue, metadata);
      setValue(newValue);
    },
    [storage, key],
  );

  return [value, updateValue];
}

/**
 * Hook for multiple reactive storage values
 */
export function useSyncValues<T extends Record<string, any>>(
  storage: RemoteStorage,
  keys: (keyof T)[],
  defaultValues?: Partial<T>,
): [
  Partial<T>,
  (key: keyof T, value: T[keyof T], metadata?: Record<string, any>) => Promise<void>,
] {
  const [values, setValues] = useState<Partial<T>>(() => {
    const initialValues: Partial<T> = {};
    keys.forEach((key) => {
      const value = storage.getItem(key as string);
      if (value !== null) {
        initialValues[key] = value;
      } else if (defaultValues?.[key] !== undefined) {
        initialValues[key] = defaultValues[key];
      }
    });
    return initialValues;
  });

  useEffect(() => {
    const handleChange = (event: ChangeEvent) => {
      if (keys.includes(event.key as keyof T)) {
        setValues((prev) => ({
          ...prev,
          [event.key]: event.newValue ?? defaultValues?.[event.key as keyof T],
        }));
      }
    };

    storage.on("change", handleChange);

    return () => {
      storage.off("change", handleChange);
    };
  }, [storage, keys, defaultValues]);

  const updateValue = useCallback(
    async (key: keyof T, value: T[keyof T], metadata?: Record<string, any>) => {
      await storage.setItem(key as string, value, metadata);
      setValues((prev) => ({ ...prev, [key]: value }));
    },
    [storage],
  );

  return [values, updateValue];
}

/**
 * Hook for connection status
 */
export function useConnectionStatus(storage: RemoteStorage) {
  const [isConnected, setIsConnected] = useState(storage.isConnected());
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo>(storage.getConnectionInfo());

  useEffect(() => {
    const updateConnection = () => {
      setIsConnected(storage.isConnected());
      setConnectionInfo(storage.getConnectionInfo());
    };

    storage.on("connect", updateConnection);
    storage.on("disconnect", updateConnection);
    storage.on("reconnect", updateConnection);
    storage.on("network-change", updateConnection);

    return () => {
      storage.off("connect", updateConnection);
      storage.off("disconnect", updateConnection);
      storage.off("reconnect", updateConnection);
      storage.off("network-change", updateConnection);
    };
  }, [storage]);

  return { isConnected, connectionInfo };
}

/**
 * Hook for sync events
 */
export function useSyncEvents(storage: RemoteStorage) {
  const [lastSyncEvent, setLastSyncEvent] = useState<SyncEvent | null>(null);
  const [lastChangeEvent, setLastChangeEvent] = useState<ChangeEvent | null>(null);
  const [lastConflict, setLastConflict] = useState<ConflictData | null>(null);

  useEffect(() => {
    const handleSync = (event: SyncEvent) => {
      setLastSyncEvent(event);
    };

    const handleChange = (event: ChangeEvent) => {
      setLastChangeEvent(event);
    };

    const handleConflict = (conflict: ConflictData) => {
      setLastConflict(conflict);
    };

    storage.on("sync", handleSync);
    storage.on("change", handleChange);
    storage.on("conflict", handleConflict);

    return () => {
      storage.off("sync", handleSync);
      storage.off("change", handleChange);
      storage.off("conflict", handleConflict);
    };
  }, [storage]);

  return {
    lastSyncEvent,
    lastChangeEvent,
    lastConflict,
  };
}

/**
 * Hook for conflict resolution
 */
export function useConflictResolution(
  storage: RemoteStorage,
  onConflict?: (conflict: ConflictData) => Promise<any> | any,
) {
  const [pendingConflicts, setPendingConflicts] = useState<ConflictData[]>([]);

  useEffect(() => {
    const handleConflict = async (conflict: ConflictData) => {
      if (onConflict) {
        try {
          const resolution = await onConflict(conflict);
          if (resolution !== undefined) {
            await storage.setItem(conflict.key, resolution);
            return;
          }
        } catch (error) {
          console.error("Conflict resolution failed:", error);
        }
      }

      // Add to pending conflicts if not resolved
      setPendingConflicts((prev) => [...prev, conflict]);
    };

    storage.on("conflict", handleConflict);

    return () => {
      storage.off("conflict", handleConflict);
    };
  }, [storage, onConflict]);

  const resolveConflict = useCallback(
    async (conflictId: string, resolution: any) => {
      const conflict = pendingConflicts.find((c) => c.id === conflictId);
      if (conflict) {
        await storage.setItem(conflict.key, resolution);
        setPendingConflicts((prev) => prev.filter((c) => c.id !== conflictId));
      }
    },
    [storage, pendingConflicts],
  );

  const dismissConflict = useCallback((conflictId: string) => {
    setPendingConflicts((prev) => prev.filter((c) => c.id !== conflictId));
  }, []);

  return {
    pendingConflicts,
    resolveConflict,
    dismissConflict,
  };
}

/**
 * Hook for performance analytics
 */
export function useAnalytics(storage: RemoteStorage) {
  const [analytics, setAnalytics] = useState(() => storage.getAnalytics());

  useEffect(() => {
    const interval = setInterval(() => {
      setAnalytics(storage.getAnalytics());
    }, 5000); // Update every 5 seconds

    return () => clearInterval(interval);
  }, [storage]);

  return analytics;
}

/**
 * Hook for batch operations
 */
export function useBatchOperations(storage: RemoteStorage) {
  const [isExecuting, setIsExecuting] = useState(false);
  const [lastResult, setLastResult] = useState<BatchResult | null>(null);

  const executeBatch = useCallback(
    async (operations: BatchOperation[]): Promise<BatchResult> => {
      setIsExecuting(true);
      try {
        const result = await storage.executeBatch(operations);
        setLastResult(result);
        return result;
      } finally {
        setIsExecuting(false);
      }
    },
    [storage],
  );

  return {
    executeBatch,
    isExecuting,
    lastResult,
  };
}

/**
 * Hook for offline/online state management
 */
export function useOfflineSupport(storage: RemoteStorage) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queuedOperations] = useState(0);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Force sync when coming back online
      storage.forceSync().catch(console.error);
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [storage]);

  // Monitor sync queue (this would require exposing queue size from RemoteStorage)
  useEffect(() => {
    const interval = setInterval(() => {
      // This is a placeholder - you'd need to expose queue size from RemoteStorage
      // setQueuedOperations(storage.getSyncQueueSize());
    }, 1000);

    return () => clearInterval(interval);
  }, [storage]);

  return {
    isOnline,
    queuedOperations,
    forceSync: storage.forceSync.bind(storage),
  };
}

// Legacy hooks for backward compatibility

/**
 * @deprecated Use useSyncStore instead
 */
export interface UseRemoteStorageOptions {
  serverUrl?: string;
  instanceId?: string;
  autoConnect?: boolean;
}

/**
 * @deprecated Use useSyncStore instead
 */
export function useRemoteStorage(userId: string, options?: UseRemoteStorageOptions) {
  const config: RemoteStorageConfig = {
    userId,
    serverUrl: options?.serverUrl || "http://localhost:3000",
    instanceId: options?.instanceId,
    autoConnect: options?.autoConnect ?? true,
  };

  const result = useSyncStore({ config });

  return {
    storage: result.storage,
    isConnected: result.isConnected,
    isLoading: result.isLoading,
    error: result.error,
    setItem: result.setItem,
    getItem: result.getItem,
    removeItem: result.removeItem,
    clear: result.clear,
    getAllItems: result.getAllItems,
  };
}

/**
 * @deprecated Use useSyncValue instead
 */
export function useStorageItem<T = any>(
  userId: string,
  key: string,
  defaultValue?: T,
  options?: UseRemoteStorageOptions,
) {
  const { storage, isConnected, isLoading, error } = useRemoteStorage(userId, options);
  const [value, setValue] = useSyncValue(storage, key, defaultValue);

  const updateValue = useCallback(
    async (newValue: T, metadata?: Record<string, any>) => {
      await setValue(newValue, metadata);
    },
    [setValue],
  );

  const removeValue = useCallback(async () => {
    await storage.removeItem(key);
  }, [storage, key]);

  return {
    value,
    setValue: updateValue,
    removeValue,
    isLoading,
    isConnected,
    error,
  };
}

/**
 * @deprecated Use useSyncStore and getAllKeys instead
 */
export function useStorageKeys(userId: string, prefix?: string, options?: UseRemoteStorageOptions) {
  const { storage, isConnected, isLoading, error } = useRemoteStorage(userId, options);
  const [keys, setKeys] = useState<string[]>([]);

  useEffect(() => {
    if (!storage) return;

    const updateKeys = () => {
      const allKeys = storage.getAllKeys();
      const filteredKeys = prefix ? allKeys.filter((key) => key.startsWith(prefix)) : allKeys;
      setKeys(filteredKeys);
    };

    updateKeys();

    const handleChange = () => {
      updateKeys();
    };

    storage.on("change", handleChange);
    storage.on("sync", handleChange);

    return () => {
      storage.off("change", handleChange);
      storage.off("sync", handleChange);
    };
  }, [storage, prefix]);

  return {
    keys,
    isLoading,
    isConnected,
    error,
  };
}

/**
 * @deprecated Use useSyncStore and length property instead
 */
export function useStorageLength(userId: string, options?: UseRemoteStorageOptions) {
  const { storage, isConnected, isLoading, error } = useRemoteStorage(userId, options);
  const [length, setLength] = useState(0);

  useEffect(() => {
    if (!storage) return;

    const updateLength = () => {
      setLength(storage.length);
    };

    updateLength();

    const handleChange = () => {
      updateLength();
    };

    storage.on("change", handleChange);
    storage.on("sync", handleChange);

    return () => {
      storage.off("change", handleChange);
      storage.off("sync", handleChange);
    };
  }, [storage]);

  return {
    length,
    isLoading,
    isConnected,
    error,
  };
}
