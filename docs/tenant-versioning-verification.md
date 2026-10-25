# Tenant and versioning verification — 2026-10-25

Tested locally with Bun 1.4.4, MongoDB 9.0.4 as a single-node replica set,
Redis 8 with AOF, and two API processes sharing the QA database and Redis prefix.
The existing user clusters were not changed. This is local verification, not a
production rollout or a prolonged load/chaos test.

## Exercised behavior

- Fresh migration and upgrade from the previous contract. An existing unmanaged
  `projects` record survives adoption. Prisma migration integrity checks pass.
- Two tenants with identical user/key/idempotency identifiers remain separate.
  HTTP writes on one API replica reach only authorized sockets on the other.
- Tenant administrators cannot create tenants, list foreign credentials, modify
  foreign keys, write a forged foreign internal identity or read foreign quotas.
  Saved reports are isolated. Suspend/resume applies to application and admin keys.
- Automatic commits, forked trees, checkpoint receipts, stale-head rejection,
  whole-tree restore, removed keys, and SDK branch headers.
- Transaction rollback preserves the previous data and head. Concurrent checkpoints
  using the same head produce exactly one winner. Reserved object keys survive.
- Projection replay after a simulated lost acknowledgement creates duplicate physical
  time-series entries but one logical timeline entry. `commit_timeline` is verified
  as a real time-series collection. Parent ordering survives simulated clock skew.
- Existing history, idempotency, outbox publication retry and operational report
  regressions pass. API unit, SDK and dashboard unit suites pass. Environment-gated
  SDK standalone live/chaos tests were skipped; the API integration suite uses the
  actual SDK and sockets against both QA replicas.
- Browser: create tenant and show its administrator secret, create checkpoint,
  fork, confirm restore; checked 390 px mobile and 1440 px desktop layouts.
  No horizontal page overflow. The browser test caught and fixed missing submit
  button types. A secret-free desktop screenshot is included in the guide.
- API, SDK and dashboard TypeScript checks; API/SDK lint; SDK/dashboard/docs builds
  and docs MDX/type checks pass.

## Query evidence

`version-store.test.ts` populates 1,000 storage rows for one user: 10 live and 990
soft-deleted. The key listing projects only `key` and sorts by `key`.

| Query plan | Returned | Keys examined | Documents examined |
| --- | ---: | ---: | ---: |
| Previous `(userId, key)` index, explicitly hinted as baseline | 10 | 1,000 | 1,000 |
| Planner-selected `(userId, isDeleted, key)` index | 10 | 10 | 0 |

This is a covered-query improvement for this access pattern; it does not imply a
universal throughput multiplier. Tenant/time and tenant/project/time indexes support
bounded reporting. Commit queries use owner/branch/time/id and bounded cursor pages;
time-series reads restrict their time range to the recent authoritative commit page.

## Limits

Prisma Mongo support remains an RC. Shared native transactions and time-series
operations remain deliberate exceptions. Trees have an 8 MiB manifest limit, forks
and restores use one MongoDB transaction, and commit/blob garbage collection is not
implemented. No Git merge/rebase or database-per-tenant provisioning is claimed.
