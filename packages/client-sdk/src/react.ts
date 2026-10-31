import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { SyncStore } from "./remote-storage";
export { useSyncStore, useSyncValue } from "./react-hooks";
export type { UseSyncStoreOptions, SyncStoreHookResult } from "./react-hooks";

const StoreContext = createContext<SyncStore | null>(null);

/** Share one application-owned client. The owner calls close() when the application ends. */
export function SyncProvider({ client, children }: { client: SyncStore; children: ReactNode }) {
  useEffect(() => {
    void client.ready().catch(() => {
      /* Exposed through the status subscription. */
    });
  }, [client]);
  return createElement(StoreContext.Provider, { value: client }, children);
}

/** Access the same client in every component without opening another connection. */
export function useSyncClient(): SyncStore {
  const client = useContext(StoreContext);
  if (!client) throw new Error("Wrap your application in SyncProvider");
  return client;
}

/** Render server acknowledgement and pending work independently of socket connectivity. */
export function useSyncStatus() {
  const client = useSyncClient();
  return useSyncExternalStore(
    (notify) => client.on("status", notify),
    () => client.getStatus(),
    () => client.getStatus(),
  );
}
