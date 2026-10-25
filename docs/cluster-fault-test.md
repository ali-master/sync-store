# Cluster load and fault regression — 2026-10-25

Tested the local `sync-store-cluster` Docker installation: two Bun API replicas,
Nginx, Redis Streams with AOF, and MongoDB. No production services were stopped.

Each run: 12 real SDK WebSocket readers, 1,800 unique REST writes through Nginx,
30 writes/second for 60 seconds, approximately 300-byte values, then a 15-second
settling period. Six readers connect directly to replica 2 and six through Nginx.
The generator runs in replica 2; this is a regression test, not a capacity benchmark.

| Scenario | Successful / sent | Missing acknowledged DB values | Stale SDK values before manual reconnect | p50 / p95 / p99 (ms) |
| --- | --- | --- | --- | --- |
| Before fix: Redis stop/start, then API SIGKILL | 1800 / 1800 | 0 | 86 | 14 / 96 / 169 |
| After fix: Redis stop/start, then API forcibly stopped for 8 seconds | 1800 / 1800 | 0 | 0 | 11 / 86 / 146 |
| After fix: API forcibly stopped while Redis was down | 1800 / 1800 | 0 | 0 | 12 / 96 / 165 |

All runs had zero HTTP errors. MongoDB contained all 1,800 expected values per run,
compared against the request ledger, not merely record counts. Manual reconnect
also produced zero stale values. The first run exposed a real delivery gap despite
successful durable writes. The fix closes local sync transports when Redis becomes
ready, causing the SDK's existing reconnect path to reconcile MongoDB state.

Run IDs, retained in test user IDs for independent inspection:

- Before: `load-6b0762c3-09e5-4898-9fd7-8d6369baf681`
- Separate faults: `load-acfde3c4-0386-4f0f-843b-67f115ff7cfe`
- Combined faults: `load-f62e2e27-b79d-4bc0-bcbe-7d170634eb85`

Reproduce with the disposable project and a write-enabled API key named
`Cluster test key` already created:

```sh
bun scripts/cluster-load.ts
bun scripts/cluster-load.ts --combined
```

The script restores both stopped services in its cleanup path and exits nonzero
on missing acknowledged data, stale SDK state, or fewer than 1,700 successful writes.
Always inspect the reported HTTP failures too; failed or timed-out requests are not
counted as acknowledged. API typecheck, lint, 15 API unit tests and 9 SDK unit tests
passed. The rebuilt Docker image was deployed to both replicas before the passing runs.

Limits: this tests unique-key writes, bounded outages and final state convergence.
It does not prove exactly-once event delivery, maximum capacity, concurrent edits to
the same key, disk failure, MongoDB failover or multi-host network partitions. There
was no transactional outbox in this initial test. That limitation is addressed by
the subsequent [atomic-outbox implementation and crash regression](./outbox-fault-test.md).
Custom clients must implement reconnect and state reconciliation.
