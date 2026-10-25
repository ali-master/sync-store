# Tenant and versioning design

Status: implementation proposal, not an available feature.

## Scope

Extend the existing project boundary to `Tenant → Project → Branch → Commit`.
Use a shared MongoDB deployment with explicit tenant ownership. Preserve existing
user-level data separation inside each project and branch. A branch must never
implicitly grant access to another user's records.

The existing installation administrator remains the platform administrator.
Tenant administrator credentials manage only their tenant's projects, application
keys and data. This builds on existing key authentication; it does not imply a new
email/password, invitation or SSO system.

## Security boundary

- Resolve tenant ownership from authenticated credentials, never trust a client
  header or query parameter as authorization.
- Tenant administrators cannot issue platform credentials, change tenant ownership
  or escalate scopes through key edits, rotation or project creation.
- Enforce tenant scope on reads, writes, counts, searches, exports, saved reports,
  version previews/restores, branches and commits.
- Derive socket room membership from the authenticated tenant/project/user/branch.
  Apply the same scope when publishing queued events and disconnecting sessions.
- Scope mutation receipts by tenant, project, branch and user. Reusing an
  idempotency key in another tenant must not reveal or replay its result.
- Keep platform-level operational metrics restricted to platform administrators.
  Tenant reports must not expose other tenants' traffic, key names, connection
  identifiers or storage volume.

## Existing data

Assign existing projects and application keys to a default tenant. Preserve their
existing data identity while ownership fields and indexes are populated. Existing
clients use the default branch until they explicitly select another branch.
Do not delete the current history or infer historical commits that were never
recorded. Deployment must handle partially completed backfills safely.

## Transactional commits and time series

Keep immutable authoritative commits and compare-and-swap branch heads in ordinary
collections. Update branch state, storage mutations, request receipts and durable
publication work in the same transaction. Reject stale expected heads rather than
overwriting concurrent commits.

Project commit history into a MongoDB time-series collection through durable work
recorded by that transaction. Time-series writes cannot participate in the storage
transaction and time-series collections do not support unique indexes. Consequently
the projection must tolerate retry duplicates by commit ID and expose projection
lag; it cannot be the sole source for restoration or branch-head correctness.

Reference: https://www.mongodb.com/docs/manual/core/timeseries/timeseries-limitations/

## Query and index work

Start index candidates with tenant equality, then project/branch scope, then the
sort or range fields used by the actual endpoint. Include deterministic tie-breakers
for cursor pagination. Use time-series metadata for tenant/project/branch equality
and its time field for bounded history queries.

Verify representative queries with `explain("executionStats")` on populated
fixtures. Compare examined keys/documents and returned rows before and after;
do not claim speed improvements from index creation alone. Preserve unique data
identity and idempotency indexes during any backfill or index replacement.

## Required validation

1. Two tenants with identical user IDs, project names, branch names, storage keys
   and idempotency keys cannot read, change or receive each other's data.
2. Tenant administrators cannot list or rotate foreign keys, preview foreign
   history, restore foreign commits, disconnect foreign sessions or export foreign
   reports, including by guessed record IDs.
3. Simultaneous commits to one branch detect a stale head; separate branches do
   not overwrite each other.
4. Crash between the transaction and time-series projection preserves recoverable
   history; retrying projection does not duplicate logical commit entries.
5. Existing data remains accessible in the default tenant and branch.
6. Dashboard and SDK use the same tenant/branch authorization contract as HTTP and
   WebSocket, including reconnection and durable offline queues.

## Outstanding decision

The database access choice is awaiting clarification: official `mongodb` driver
without any ORM, or Prisma-only access without direct MongoDB calls. The user's
previous wording excludes both Prisma and Mongo ORM but may contain a typo. Do not
perform a repository-wide persistence rewrite until this is resolved.
