<p align="center">
  <img src="assets/logo.svg" alt="Sync Store" width="112" height="112" />
</p>

# Sync Store

**Keep your application's data in sync across tabs, devices and connected clients.**

A preference changes in one place. Another client sees it. A connection drops, work
queues locally, and pending changes are sent when the client reconnects. Sync Store
provides the storage, synchronization and recovery tools behind those experiences,
so you can focus on what your application does with the data.

Use it for JSON data such as user preferences, application settings and shared
application state. Run it on your own infrastructure and manage it from one dashboard.

## What you can do

- **Keep connected experiences consistent.** Save a value once and deliver changes
  to authorized clients without building your own broadcasting and reconnect logic.
- **Continue through connection interruptions.** The client keeps pending writes in
  local storage and reconciles with the server after reconnecting.
- **Recover from unwanted changes.** Inspect retained versions, restore individual
  keys, or create branches and checkpoints for a complete user's data snapshot.
- **Give each customer a separate workspace.** Tenants have their own administrators,
  projects, application keys, data and reports.
- **Control access from the dashboard.** Issue and rotate keys, restrict permissions,
  set request quotas, inspect records and manage live connections.
- **Understand how the service is being used.** Explore request trends, quota usage,
  publication health and data growth, then save report views or export CSV.

## See synchronization happen

The [playground](examples/README.md) connects two real clients to your running
installation. Change a value on one side, watch the other update, then disconnect
and reconnect a client to see queued delivery in action.

To connect your own application:

```ts
import { RemoteStorage } from "@usex/sync-client";

const store = new RemoteStorage({
  serverUrl: "https://sync.example.com",
  apiKey: applicationKey,
  userId: authenticatedUserId,
  namespace: "production:customer-a:project-a",
  autoConnect: false,
});

await store.connect();
await store.setItem("preferences", { theme: "dark" });
const preferences = await store.getItem("preferences");

// Release the connection when this client is no longer needed.
store.destroy();
```

Use a distinct, stable cache namespace for each backend, tenant and project.
An API key authorizes application access; it does not authenticate the user ID
supplied by a caller. Validate user identity in a trusted application backend and
keep administrator or unrestricted shared keys out of public browser code.

## Run your own installation

You only need **Docker with Compose** on the host. The
[self-hosting guide](apps/docs/content/docs/guides/self-hosted.mdx) walks through
creating secrets and starting the service. You do not need a local runtime or
database installation.

Once the service is running:

1. Open `/dashboard/` and use the setup code from the server logs.
2. Create and save your administrator key.
3. Issue a separate application key, then connect your application or the playground.

The dashboard serves daily administration; `/api/docs` provides the interactive API
reference. For multiple backend replicas, follow the
[deployment guide](apps/docs/content/docs/guides/deployment.mdx).

## Choose your next step

| Your goal | Start here |
| --- | --- |
| Run Sync Store on your own server | [Self hosting](apps/docs/content/docs/guides/self-hosted.mdx) |
| Connect an application | [Client SDK](packages/sync-client/README.md) |
| Explore a working example | [Examples](examples/README.md) |
| Manage credentials and data | [Dashboard guide](apps/docs/content/docs/guides/dashboard.mdx) |
| Separate customer workspaces | [Multi-tenancy](apps/docs/content/docs/guides/multi-tenancy.mdx) |
| Recover data or experiment on a branch | [Branches and commits](apps/docs/content/docs/guides/branches-and-commits.mdx) |
| Investigate usage and delivery | [Operational reports](apps/docs/content/docs/guides/operational-reports.mdx) |
| Contribute or run the source locally | [Development setup](apps/docs/content/docs/getting-started.mdx) |

## What to expect

A successful server mutation records both its data and pending publication work in
one transaction. Delivery is **at least once**: a lost acknowledgement can cause a
retry. Mutation request IDs make supported retries safe, and clients reconcile with
the server after reconnecting. An acknowledgement does not mean every peer has
already received the change.

Concurrent writes use last-write-wins behavior. Branches and commits belong to one
tenant, project and user; they are not a collaborative text editor or a full Git
implementation. Commit snapshots currently have no automatic expiry, so plan storage
and backups. The persistence integration remains early access; review the
[deployment limits](apps/docs/content/docs/guides/deployment.mdx) before production use.

## Work on the project

Follow the development setup first. From the repository root, the main checks are:

```sh
bun run test:types
bun run lint
bun run test
bun run build
```

Runtime requirements and database setup live in the development guide. Integration
tests need explicitly configured, disposable test services; a passing default test
run alone does not verify a deployed installation.

## License

Apache-2.0.
