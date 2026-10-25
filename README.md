<p align="center">
  <img src="assets/logo.svg" alt="Sync Store" width="112" height="112" />
</p>

# Sync Store

A Bun/TypeScript monorepo for synchronizing JSON values between browser instances and devices.

- `apps/api`: NestJS HTTP and Socket.IO API, backed by MongoDB 9.
- `packages/sync-client`: local cache, durable pending writes, HTTP/WebSocket transports and React hooks.
- `packages/utils`: shared utilities.
- `apps/docs`: Next.js/Fumadocs documentation.
- `examples/react-app`: React example.

## Self hosting

Only Docker with Compose is required. Follow [Self hosted](apps/docs/content/docs/guides/self-hosted.mdx)
to generate your secrets and run `docker compose up -d --build`. Bun, Node.js and MongoDB run inside containers.

## Development requirements

Explore the [interactive playground](examples/README.md), follow the
[getting-started guide](apps/docs/content/docs/getting-started.mdx), or run
`bun run --cwd apps/docs dev` to browse the complete documentation.

- Bun 1.4.4 or newer.
- MongoDB 9.0.4; use a managed replica set with authentication, TLS and backups for production.
- Docker is optional for local MongoDB and API images.

Prisma CLI is pinned to **8.0.0-rc.27** and its MongoDB library to **8.0.0-rc.20**.
MongoDB support in Prisma 8 is early access. This is an explicit compatibility risk, not a claim of production certification.
TypeScript 6 remains the compiler API used by tsup and type checks; TypeScript 7 is available through the `@typescript/native` alias. The API builds with SWC; type checking runs separately with `bun run test:types`.

## Development

```sh
bun install --frozen-lockfile
cp apps/api/.env.example apps/api/.env.local
# Set DATABASE_URL and JWT_SECRET in apps/api/.env.local.
bun run db:generate
bun run db:deploy
bun run build:api
bun run dev:api
```

The API serves `/api/v1` and Socket.IO namespace `/sync`.
For horizontal scaling, use shared MongoDB and Redis with `docker compose -f compose.yml -f compose.scale.yml up -d --build --scale api=3`. The proxy exposes one address and the SDK uses WebSocket-only transport. See the [scaling guide](apps/docs/content/docs/guides/deployment.mdx).
Open `/dashboard/` and follow first-time setup using the setup code in the API logs. Create and save your administrator key, then issue application keys in the console. See the [dashboard guide](apps/docs/content/docs/guides/dashboard.mdx).
Swagger is at `/api/docs`. To run with Docker without installing Bun, see [Self hosted](apps/docs/content/docs/guides/self-hosted.mdx).

## Client

```ts
import { RemoteStorage } from "@usex/sync-client";

const storage = new RemoteStorage({
  serverUrl: "http://localhost:3000",
  apiKey: "a-key-issued-for-this-application",
  userId: "authenticated-user",
  instanceId: "unique-tab-or-device-id",
  mode: "auto",
  autoConnect: false,
});
await storage.connect();
await storage.setItem("preferences", { theme: "dark" });
const preferences = await storage.getItem("preferences");
storage.destroy();
```

**Authentication boundary:** an API key currently authorizes the caller to supply user IDs.
A shared key embedded in a public browser app is not end-user authentication.
Keep unrestricted keys on a trusted server and validate user identity there before forwarding requests.
Do not expose this API directly to untrusted users with a shared key.

## Verification

```sh
bun run test:types
bun run lint
bun run build
bun run test
# Prepare a separate empty test database with db:deploy, then:
TEST_DATABASE_URL=mongodb://127.0.0.1:27017/sync_store_test bun run --cwd apps/api test:e2e
docker build -f apps/api/Dockerfile -t sync-store .
```

Integration tests create and remove only their own uniquely identified fixtures.
They are skipped unless TEST_DATABASE_URL is explicitly set.

## Synchronization guarantees and limits

Pending writes are persisted before sending and removed after an acknowledgement. Failed writes remain queued.
Delivery is at least once: a lost acknowledgement may replay an already applied operation.
Reconnect downloads the current server snapshot, including deletions, without uploading stale cache entries.
The server increments versions atomically; simultaneous writes use last-write-wins behavior.

The cache's encryption option is rejected because the previous implementation did not provide encryption.
Historical analytics that were previously fabricated are now reported as unavailable.
Conflict-resolution endpoints return and record a resolution decision; callers must write the returned value through the normal storage endpoint.
Socket.IO broadcasts are process-local; run one API instance until a shared adapter and cross-instance tests are added.

## License

Apache-2.0.
