# Atomic outbox validation — 2026-10-25

## Implementation

Storage mutations and immutable pending events are written in one MongoDB document
update, with journaled majority acknowledgement. No replica set or multi-document
transaction is required. Per-item leases coordinate API dispatchers. Redis `XADD`
and `WAITAOF` must succeed before the claimed head is removed. Failed publication
and process crashes retain pending work. Duplicate retries use stable event IDs;
SDK record versions prevent duplicate or stale events from rolling back state.

The schema migration adds optional `outbox`, `leaseToken` and `leaseUntil` fields
without rewriting or deleting existing storage. Physical cleanup excludes pending
tombstones. A real MongoDB integration test verifies set/update/remove/clear,
retry IDs, cleanup protection, and atomic rejection of an oversized write.

## Crash precisely before publication

Command: `bun scripts/cluster-load.ts --outbox`

- Run: `load-5297668f-d682-47d3-8d1e-f56b5b712fab`.
- Two normal API replicas, Redis AOF and MongoDB, plus a temporary fault-injected replica.
- Twelve SDK readers stay on a healthy replica; 1,800 logical writes at 30/second.
- Initial writes go directly to the temporary replica. Failed requests retry through Nginx.
- A test-only preload blocks its dispatcher **after the MongoDB commit and lease claim,
  before Redis publication**. The harness captures the event ID and sends SIGKILL.
- Captured event: `50a5f087-aae7-4b56-9f47-e15576246c3f:1`.
- All 1,800 logical writes succeeded; 110 required a retry (1,910 HTTP write attempts).
- All 1,800 expected values persisted; zero missing acknowledged event IDs, zero stale
  SDK values before manual reconnect, and zero pending events after recovery.
- The captured crash event reached the SDK through a surviving dispatcher.
- Logical write latency p50/p95/p99: **17 / 5,015 / 5,891 ms**. The tail includes the
  deliberately targeted dead replica's five-second timeout before retry; it is not
  steady-state API latency.

Event delivery assertions inspect SDK events with real `eventId` values **before**
manual reconnect. Snapshot reads cannot satisfy them. The fault preload is mounted
only into the disposable replica and is absent from the production startup command.
The temporary replica is removed after the test; fixture data is retained for inspection.

## Redis outage with a backend crash

Command: `bun scripts/cluster-load.ts --combined`

Run `load-fb32bc75-1eb1-47b1-b92c-330369ea8524` stopped Redis, forcibly stopped
one API while Redis was unavailable, then restored both under the same 30 writes/second
load. All 1,800 writes succeeded without harness retries. Missing acknowledged values,
stale SDK values before manual reconnect and pending events were all **zero**.
Latency p50/p95/p99 was **12 / 92 / 172 ms**. This scenario verifies final state and
queue drainage; the earlier targeted-crash scenario additionally verifies each acknowledged event ID.

Validation also passed API and SDK typechecks, API lint, docs typecheck, SDK build,
15 API unit tests, 10 SDK unit tests, the isolated MongoDB integration test (13 assertions),
and the two-replica live integration test (14 assertions). Both normal replicas run the
rebuilt image; Redis, MongoDB and the proxy remain running after cleanup.

## Guarantees and limits

Delivery is at least once, not exactly once. Writes and clear are atomic per item;
clear is not one all-or-nothing transaction across a user's keys. Redis AOF and its
storage volume must survive; the 100,000-entry stream is not unlimited event history.
Disconnected clients still need snapshot reconciliation. Pending events count toward
MongoDB's 16 MiB document limit; an overfull item rejects further writes atomically.

This test does not simulate physical disk loss, MongoDB failover, or a multi-host
network partition. It verifies the previously exposed commit-to-publication crash gap.
