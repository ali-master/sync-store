# Sync Store service

**Store application data, deliver changes and keep recovery within reach.**

This service is the shared home for your application's JSON data. It accepts writes,
makes them available to authorized clients and records the publication work needed
to deliver changes. The included dashboard lets an operator manage the installation
without writing scripts for everyday tasks.

## What it provides

- **Shared state:** clients read and update user-scoped values and receive live changes.
- **Safe retries and recovery:** mutation receipts, retained key history and atomic
  commits help recover from interrupted requests or unwanted edits.
- **Separate customer workspaces:** tenant administrators manage only their own
  projects, keys, records, connections and reports.
- **Controlled access:** application keys define read/write permissions, key prefixes,
  request quotas and connection restrictions.
- **Operational visibility:** inspect data, review activity and follow usage, growth
  and publication trends from the dashboard.

Branches let a user namespace diverge from a committed snapshot. Restoring a snapshot
creates a new synchronized change rather than rewriting its history.

## Start using it

For a hosted installation, follow the
[self-hosting walkthrough](../docs/content/docs/guides/self-hosted.mdx). It covers
setup, secrets and persistent storage using Docker alone.

After startup, open `/dashboard/`. Use the setup code printed in the server logs to
create your administrator key, save it securely and issue a separate application
key. Existing installations sign in with their saved administrator key.

| Entry point | What it is for |
| --- | --- |
| `/dashboard/` | Onboarding, credentials, data management and reports |
| `/api/docs` | Interactive request and response reference |
| `/api/v1` | Application storage and management requests |
| `/sync` | Live client synchronization |

See the [client SDK](../../packages/sync-client/README.md) to connect an application,
or the [examples](../../examples/README.md) to try two connected clients.

## Operate with clear boundaries

An application key is not proof of the caller's user identity. Authenticate users in
your application and protect administrator credentials. Tenant ownership comes from
the stored credential, not a client-supplied tenant header.

An accepted mutation durably records its pending event; delivery may be retried.
Multiple backend replicas require the shared services described in the
[deployment guide](../docs/content/docs/guides/deployment.mdx). Back up the database
and verify recovery before relying on it. Snapshot history does not replace backups.

For operational details, read [SELF_HOSTED.md](SELF_HOSTED.md),
[API key management](../docs/content/docs/guides/api-key-management.mdx) and
[branches and commits](../docs/content/docs/guides/branches-and-commits.mdx).

## Develop the service

Complete the [development setup](../docs/content/docs/getting-started.mdx) and
configure the development database and secrets before running these commands from
the repository root:

```sh
bun run db:generate
bun run db:deploy
bun run build:api
bun run dev:api
```

The persistence contract is maintained in `src/modules/db/contract.prisma`; generated
files should be rebuilt with `db:generate`. Keep storage mutations, history, commit
heads and pending publication in the same transaction when changing write behavior.

```sh
bun run --cwd apps/api test
bun run --cwd apps/api test:types
bun run --cwd apps/api lint
```

Integration tests require explicitly configured test services. Use a disposable
database rather than an installation containing data you need to preserve.
