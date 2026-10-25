# TLS and quota rollover cluster verification

Date: October 25, 2026. Local Docker project: `sync-store-cluster`, MongoDB 9, two Bun API replicas and Nginx.

## Issues fixed

1. Fastify trusted no reverse proxy and Socket.IO saw the internal cleartext connection. Added explicit immediate-peer IP/CIDR trust shared by both transports. Nginx overwrites forwarding headers, and backend ports remain private.
2. Each replica's cron previously zeroed counters independently. A delayed second reset could erase new usage. Added nullable per-period window markers, a MongoDB migration, database-time UTC boundaries, idempotent scheduled resets and atomic rollover/check/increment on request admission.

The schema migration preserves data and existing outbox fields. Existing keys without window markers receive a fresh allowance once on upgrade.

## Results

- Certificate-verified HTTPS succeeded; no `rejectUnauthorized: false` or insecure curl option was used.
- A WSS connection completed a `sync:getAll` operation with an HTTPS-required key.
- HTTP with forged `X-Forwarded-Proto: https` failed with 403.
- Direct requests to **both** backend IPs with forged forwarding headers failed with 403.
- A forged client IP sent through the proxy could not bypass an IP allowlist.
- For each of minute/hour/day/month, a stale window with usage 999 and limit 20 received 60 concurrent HTTPS requests: **20 admitted, 40 rejected, stored counter exactly 20**. Nginx response evidence identified both upstreams (`172.26.0.4:3000`, `172.26.0.5:3000`).
- MongoDB integration tests sent 100 concurrent consumption attempts per period with limit 20; exactly 20 succeeded. Duplicate reset workers, reset after consumption, and late reset after rollover preserved the count.
- Database-expression tests covered minute/hour boundaries, leap day, February-to-March and December-to-January rollover.
- Both running replicas' real schedulers were active when an idle test key reset from `2026-10-25T11:54:00Z` to `11:55:00Z`, without a request triggering rollover.
- 18 API unit tests and 8 existing MongoDB/outbox integration tests passed, as did typechecking and the documentation build. New integration files passed separately: quota windows (26 assertions), TLS/cluster (18), live cron (2).
- All temporary test API keys and fixture collections were removed by test cleanup. Existing application keys were not edited.

## Repeat the tests

Run inside a test API container that has the current source and test dependencies. `DATABASE_URL` must point to the migrated test database. For TLS, use a test certificate with a SAN matching the proxy hostname and explicitly trust its CA file.

```sh
TEST_DATABASE_URL="$DATABASE_URL" bun test test/integration/quota-window.test.ts
TEST_TLS_URL=https://proxy TEST_HTTP_URL=http://proxy:3000 \
TEST_TLS_CA=/tmp/qa-ca.pem \
TEST_REPLICA_URLS=http://172.26.0.4:3000,http://172.26.0.5:3000 \
  bun test test/integration/proxy-cluster.test.ts
TEST_LIVE_QUOTA_CRON=1 bun test test/integration/quota-cron.test.ts
```

Use the current replica addresses. The test Nginx configuration includes `add_header X-QA-Upstream $upstream_addr always` solely to prove both backends handled traffic; the production template does not expose this diagnostic header. The live cron test waits up to 65 seconds and requires a running scheduler against the same database.

## Local deployment and limits

The API image was rebuilt and both API containers were recreated from it. The final overlay has no source or `dist` bind mount. The temporary TLS configuration and certificate remain mounted for local testing; recreating this test cluster requires the same overlay file.

The local test overlay is `/tmp/sync-cluster-tls/override.yml`, used after `compose.yml` and `compose.scale.yml`. It pins the test proxy to `172.26.0.250`, adds certificate-verified HTTPS at `https://localhost:34443`, and retains the existing HTTP test endpoint at port 34085. Its certificate is a **two-day local test certificate**, not a production certificate. The reusable production configuration is `compose.tls.yml` with `docker/nginx/tls.conf`.

Hourly, daily and monthly boundaries were evaluated with controlled MongoDB date expressions and stale-window fixtures; the host clock was not changed and the test did not wait a month. Real elapsed-time cron was verified at a minute boundary. This does not certify certificate renewal, multiple proxy hops, or physical network failure behavior.

Implementation references: [Fastify proxy trust](https://fastify.dev/docs/latest/Reference/Server/#trustproxy) and [MongoDB UTC date truncation](https://www.mongodb.com/docs/manual/reference/operator/aggregation/datetrunc/).
