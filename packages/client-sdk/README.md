# Sync Store client

**Give your application a consistent view of its data, even across reconnects.**

The client connects your application to Sync Store, keeps a local cache and manages
pending writes. Save JSON values, receive changes from other clients and recover
from connection interruptions without building a separate retry queue for each
application feature.

Use it for preferences, settings and other application state shared across connected
tabs or devices. It also exposes recovery tools for inspecting history, creating
checkpoints and working with branches.

## Connect and save a value

Install `@usex/sync-store` in your application:

```sh
bun add @usex/sync-store
```

Create an application key in your running service's dashboard, then connect:

```ts
import { SyncStore } from "@usex/sync-store";

const store = new SyncStore({
  serverUrl: "https://sync.example.com",
  apiKey: applicationKey,
  userId: authenticatedUserId,
  namespace: "production:customer-a:project-a",
  autoConnect: false,
});

await store.connect();
await store.setItem("settings", { theme: "dark" });
const settings = await store.getItem("settings");

// When the application no longer needs this client:
store.destroy();
```

The key selects the tenant and project on the server. Choose a stable, distinct local
`namespace` for each backend, tenant and project so cached data and queued work do
not mix when switching workspaces.

## Keep work through a disconnect

`setItem`, `removeItem` and `clear` persist pending operations before sending them.
Offline writes remain queued locally. A failed online write rejects and stays queued
for retry; handle the error rather than treating it as confirmed delivery.

On `connect()`, the client flushes pending operations, downloads current server state
and restores subscriptions. Remote deletions remove stale local entries. Delivery is
at least once, and mutation retries retain their request IDs. Keep the same namespace
to recover persisted pending work after a reload. Clearing browser storage removes
that local recovery path.

See [offline and reconnect behavior](../../apps/docs/content/docs/guides/offline-sync.mdx)
and [safe retries](../../apps/docs/content/docs/guides/idempotency.mdx).

## Recover and experiment safely

- Inspect retained key versions with `getHistory()` and preview a recovery with
  `previewRestore()` before calling `restoreVersion()`.
- Read branch heads with `getBranches()` and create a named checkpoint with `commit()`.
- Fork a snapshot with `createBranch()` and connect a separate client using its
  `branch` option. The default is `main`.
- Use `restoreCommit()` to restore a whole tree with an expected head, so a concurrent
  change is rejected instead of silently overwritten.

Branches belong to a tenant, project and user. Keep a separate client for each branch
so pending writes retain their destination. Whole-tree version operations require
unrestricted read access, and mutations also require write access.

The [branches and commits guide](../../apps/docs/content/docs/guides/branches-and-commits.mdx)
includes complete examples and current limits.

## Fit the client into your application

Use `mode: "auto"` for live synchronization with an HTTP fallback, `"websocket"` for
live connections only, or `"http"` for request-based access. HTTP defaults to `/api/v1`;
a custom API path can be supplied in `serverUrl`. Multiple service replicas require
the shared delivery setup in the [deployment guide](../../apps/docs/content/docs/guides/deployment.mdx).

For React applications, `useSyncStore` and `useSyncValue` connect storage to component
state. See [React integration](../../apps/docs/content/docs/guides/react.mdx), the
[client guide](../../apps/docs/content/docs/guides/client-sdk.mdx) and the
[two-client playground](../../examples/README.md).

An API key is an application credential, not authentication for the supplied user ID.
Authorize users in a trusted backend; never distribute an administrator or unrestricted
shared key in a public browser app. Local cache encryption is not implemented, and
unsupported encryption and compression options are rejected. React hooks are available
from `@usex/sync-store/react`; transport and diagnostic utilities use `/advanced`.

## Work on the client

From the repository root:

```sh
bun run --cwd packages/client-sdk test
bun run --cwd packages/client-sdk test:types
bun run --cwd packages/client-sdk build
```

Default tests cover client behavior locally. Live synchronization tests require their
configured test services; see the service's integration tests for cross-replica and
tenant-isolation scenarios.

## Publish the SDK (maintainers)

Run these commands from the repository root after `bun install`. No global npm
or Node.js installation is required: release-it and the locally installed official
npm CLI run on Bun. The CLI handles authentication checks and version updates;
Bun publishes the package. Your npm account
must have publishing access to the `@usex` scope.

```sh
bun run --cwd packages/client-sdk npm:cli login --registry=https://registry.npmjs.org/
# Preview the first release; does not publish, commit, tag or push.
bun run release:sdk 0.1.0 --dry-run
# Publish after reviewing the preview (interactive confirmation).
bun run release:sdk 0.1.0
# Subsequent releases:
bun run release:sdk patch
```

Start on `master` with a clean working tree and an upstream branch. The release
checks SDK types and local unit tests, builds the package, updates its version and
the root Bun lockfile, creates a release commit and an `sdk-v<version>` tag, and
pushes to the configured Git remote. Only `@usex/sync-store` is published, with
public access; the private application workspaces are not released. GitHub Release
creation is enabled and requires a `GITHUB_TOKEN` with release access to the repository. The `prepack` hook rebuilds the SDK for direct packing too.

For a preview without npm credentials, add `--npm.skipChecks` to the dry-run
command. This skips registry and account checks, so it cannot confirm publishing
permissions or whether the version already exists. Keep those checks enabled for
real releases. Never commit npm tokens; complete npm authentication and any 2FA
prompt locally. Live API and cluster tests are separate from these release checks.

### Verify the installable package

```sh
bun run --cwd packages/client-sdk test:package
```

This check packs the SDK and installs the tarball with the local npm CLI running
on Bun in a temporary project outside the workspace. It verifies core imports
without React, all four public entry points in Bun (ESM and CommonJS), offline
writes and removals, strict TypeScript declaration emission, and browser bundling.
It requires Bun and registry access, removes its temporary files, and does not
publish. The release checks run it automatically before a release. To additionally
test a separately installed Node.js runtime, run
`bun run --cwd packages/client-sdk test:package:node` outside the release process.

Transport consumers can import `BatchOperation`, `BatchResult`, `SyncFilter` and
`EventEmitter` from `@usex/sync-store/advanced`; no internal source paths are needed.

### One client: SyncStore

Use `new SyncStore(config)` to create a client with explicit credentials (keep
application keys on your server), or `await SyncStore.connect({ serverUrl, session })`
to obtain a ready browser client using a user-bound session. Both paths use the
same `SyncStore` class. The browser connection returns `{ storage, expiresAt }`;
call `storage.destroy()` when finished or before renewing its session.

This is a breaking SDK API change: replace `new RemoteStorage(config)` and
`createRemoteStorage(config)` with `new SyncStore(config)`. Replace the old
`await SyncStore(options)` browser factory with `await SyncStore.connect(options)`.
Use `SyncStoreConfig` for configuration types. The old class and factory are no
longer exported. React hooks remain in `/react`, compatibility hooks in `/legacy`,
and transport utilities in `/advanced`.
