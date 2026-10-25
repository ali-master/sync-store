# @usex/sync-client

Synchronize JSON values through HTTP or Socket.IO with a local cache and persistent pending writes.

```sh
bun add @usex/sync-client
```

```ts
import { RemoteStorage } from "@usex/sync-client";

const store = new RemoteStorage({
  serverUrl: "https://sync.example.com",
  apiKey: "issued-key",
  userId: "user-id",
  instanceId: "device-id",
  mode: "auto", // "http" | "websocket" | "auto"
  autoConnect: false,
});
await store.connect();
await store.setItem("settings", { theme: "dark" });
await store.getItem("settings");
await store.removeItem("settings");
await store.clear();
store.destroy();
```

`setItem`, `removeItem` and `clear` persist pending operations before sending.
A failed online write rejects and stays queued for retry. Offline writes are queued locally.
`connect()` flushes pending operations, downloads the server snapshot and restores subscriptions.
Remote deletions remove stale local entries. Quota errors do not evict unrelated pending data.

HTTP uses `/api/v1` by default and accepts a custom path in `serverUrl`.
Socket.IO uses WebSocket-only transport, allowing connections through a load balancer without sticky sessions. API replicas must share MongoDB and the Redis Streams adapter. After reconnect, the SDK reconciles persisted state from the server.
Credentials use headers for HTTP and the Socket.IO auth handshake for WebSocket.
Retries of mutations are controlled by the outbox; delivery is at least once, not exactly once.

The package exports `useSyncStore` and `useSyncValue` for React.
Call `destroy()` when manually owned clients are no longer needed.
The old `encryptionKey` option now throws instead of silently storing plaintext.

An API key is an application credential, not proof of the supplied user's identity.
Use a trusted application backend for authorization; do not ship unrestricted shared keys to public browsers.

```sh
bun run build
bun run test:types
bun test
```
