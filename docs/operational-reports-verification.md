# Operational report verification — 2026-10-25

Implemented administrator pages: Sync health, Usage & quotas, Changes & growth.
Each uses the existing authenticated console, TanStack Query and table components.
No new runtime dependency was added.

## Local checks

- API: 27 unit tests passed; typecheck and lint passed.
- Dashboard: 7 unit tests passed, including CSV quoting/formula escaping;
  typecheck and production build passed.
- Documentation production build passed.
- MongoDB 9.0.4 disposable replica set: 12 integration tests passed, 3 environment-
  specific tests skipped. Covered quota rollover, transactional history/change-event
  rollback, idempotent retries, ordered outbox recovery and report aggregation.
- The focused report integration test passed 25 assertions: merging replica
  histograms, preventing multiplied shared snapshots, project filtering, expired
  quota counters, excluding tombstones from active bytes, private value exclusion,
  and saved-view create/delete/validation.
- Two Bun API processes sharing an isolated Redis 8 instance with AOF passed the
  existing cross-replica HTTP/WebSocket/SDK test (27 assertions).

## Live observations

- Twelve real HTTP writes and one read produced 13 HTTP responses, 12 write
  admissions and one read admission in the usage report.
- The changes page showed one creation and eleven updates for those writes.
- Report endpoints returned HTTP 401 without administrator authentication.
- Saved-view creation, loading and deletion worked in the browser. CSV downloaded
  successfully and contained interval/snapshot rows plus range/filter metadata.
- All three pages rendered without horizontal document overflow at 390×844.
  The desktop view was also inspected at 1440 pixels wide.
- An inherited local Redis setting initially selected a Redis instance without
  AOF. The health report exposed failed publication attempts and the outbox retained
  its work. Tests were then explicitly isolated using `REDIS_URL` and
  `SOCKET_IO_PREFIX`. After recovery the report showed successful publications and
  a direct MongoDB check found zero items with pending outbox events. No Redis
  configuration outside the disposable test environment was modified.

## Scope and limits

These are local functional checks, not production deployment or a capacity test.
TLS and the real-time quota-cron suite were not rerun. Size sampling scans current
storage/history once per minute cluster-wide and has bounded query timeouts; large
installations may need incremental size counters. Operational counters/snapshots
are best-effort, while mutation change events share the storage transaction.
Publication metrics do not prove application-client acknowledgement. Existing
Vite bundle-size warning remains; it does not fail the build.

Run report integration tests against a disposable MongoDB with
`TEST_REPORTS_DATABASE_URL`; transaction suites require a replica set and
`TEST_DATABASE_URL`. Explicitly set `REDIS_URL` and `SOCKET_IO_PREFIX` when starting
test APIs so local environment files cannot select another Redis instance.
