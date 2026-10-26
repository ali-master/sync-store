import { RemoteStorage } from "./remote-storage";
import type { RemoteStorageConfig, StorageItem, SyncEvent, StorageEventType } from "./types";

// Core exports
export { RemoteStorage };
export type { RemoteStorageConfig, StorageItem, SyncEvent, StorageEventType };
export type { SyncStatus, ClientLogger } from "./types";

// Factory function
export function createRemoteStorage(config: RemoteStorageConfig) {
  return new RemoteStorage(config);
}

export interface BrowserSession {
  token: string;
  expiresAt: number;
  userId: string;
  branch: string;
  cacheScope: string;
}

/** Connect using a user-bound session obtained from your authenticated application backend. */
export async function connectBrowser(options: {
  serverUrl: string;
  session: () => Promise<BrowserSession>;
  mode?: RemoteStorageConfig["mode"];
}): Promise<{ storage: RemoteStorage; expiresAt: number }> {
  const session = await options.session();
  if (
    !session.token?.startsWith("ss_session.") ||
    !Number.isFinite(session.expiresAt) ||
    session.expiresAt <= Date.now() ||
    !session.userId ||
    !session.branch ||
    !/^[a-f0-9]{64}$/.test(session.cacheScope)
  )
    throw new Error("Invalid or expired browser session");
  const endpoint = new URL(options.serverUrl);
  const storage = new RemoteStorage({
    serverUrl: options.serverUrl,
    apiKey: session.token,
    userId: session.userId,
    branch: session.branch,
    mode: options.mode,
    namespace: JSON.stringify([
      endpoint.origin,
      endpoint.pathname.replace(/\/$/, ""),
      session.cacheScope,
    ]),
    autoConnect: false,
  });
  try {
    await storage.ready();
  } catch (error) {
    storage.destroy();
    throw error;
  }
  return { storage, expiresAt: session.expiresAt };
}
