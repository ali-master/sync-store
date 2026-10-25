# Sync Store API

NestJS on Bun, with MongoDB 9 and Prisma ORM 8.

The persistence contract is `src/modules/db/contract.prisma`; `contract.json` and `contract.d.ts` are generated with `bun run db:generate`.
Prisma handles typed reads and ordinary writes. Atomic counters, upserts and aggregation pipelines use the MongoDB driver on the same connection pool.

```sh
bun run db:generate
bun run db:deploy
bun run build
bun run start:prod
```

Configure `DATABASE_URL` and application settings using `.env.example`.
Open `/dashboard/` and complete onboarding with the setup code from the API logs to create your first administrator key. Save it securely, then manage application keys and data in the console. Recover the existing administrator credential locally with `bun run admin:key`.
There are no default production credentials or automatic prune/reset steps.

See [SELF_HOSTED.md](SELF_HOSTED.md) for deployment, data transfer, validation and limitations.
