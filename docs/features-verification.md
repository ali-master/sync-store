# Safe retries, project access and recovery verification

Verified on October 25, 2026 with Bun 1.4.4 and MongoDB 9.0.4.

## Coverage

- API unit tests: 20 passed. Dashboard tests: 6 passed. SDK tests: 11 passed;
  3 environment-dependent legacy live tests were skipped.
- API integration suite against a disposable migrated database: 12 passed,
  2 TLS/clock-bound cluster tests skipped. Final focused storage/history/receipt/ORM
  rerun: 10 passed, including equal-timestamp history pagination and metadata restore.
- End-to-end test with writes pinned to backend 2 and HTTP reads/Socket.IO pinned
  to backend 1: 27 assertions passed. Covered isolation, restricted list/event
  delivery, revoked keys, receipt replay/mismatch, history, stale previews and SDK restore.
- API, dashboard and SDK typechecks passed; API and SDK lint passed.
- API/dashboard production build and docs production build passed.
- Browser dashboard restore completed through preview and confirmation. At 390×844,
  the sheet fit the viewport and the document had no horizontal overflow.

The Compose stack started from fresh volumes with its authenticated single-node
replica-set scripts, Redis AOF and two API replicas. After the initial image build,
the final locally compiled API output was copied into both disposable containers
and they were restarted before the cross-replica rerun. This verifies the final
application output, not a published release image.

## Reproduce

Use a disposable installation, never a production database. Apply migrations first.
The project test completes first-run setup if necessary and creates test projects,
keys and data in that installation.

```sh
bun run --cwd apps/api test
bun run --cwd apps/dashboard test
bun run --cwd packages/sync-client test
TEST_DATABASE_URL=YOUR_DISPOSABLE_REPLICA_SET_URL bun run --cwd apps/api test:e2e
TEST_DATABASE_URL=YOUR_DISPOSABLE_REPLICA_SET_URL \
TEST_API_URL=http://backend-1:3000 \
TEST_WRITE_API_URL=http://backend-2:3000 \
bun test apps/api/test/integration/projects.test.ts
```

## Boundaries

The receipt rollback test injects an exception before commit; it is not a new
process-kill load test. No new throughput certification, TLS test or real-clock
quota test was performed. A single MongoDB member enables transactions but has no
database failover. Recovery restores individual keys, not an entire project's
point-in-time snapshot. Receipts currently have no automatic expiry.
