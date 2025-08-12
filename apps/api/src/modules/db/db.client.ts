import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { Prisma, PrismaClient } from "@prisma/client";
// Types
import type { TransactionHost } from "@nestjs-cls/transactional";
import type { TransactionalAdapterPrisma } from "@nestjs-cls/transactional-adapter-prisma";

// Use MariaDB adapter for MySQL connection
const adapter = new PrismaMariaDb({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 3306,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
  user: process.env.DB_USERNAME || "root",
  password: process.env.DB_PASSWORD || "pass123",
  database: process.env.DB_DATABASE || "sync_store",
  ssl: process.env.DB_SSL === "true",
  timezone: "UTC",
  autoJsonMap: false,
  bigIntAsNumber: true,
});

const prisma = new PrismaClient({
  adapter,
  transactionOptions: {
    maxWait: 60_000,
    timeout: 60_000,
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  },
  errorFormat: "pretty",
});

export const DBClient = prisma.$extends({
  client: {
    async $prometheus() {
      return prisma.$metrics.prometheus();
    },
  },
});

export type PrismaTransactor = TransactionHost<TransactionalAdapterPrisma<typeof DBClient>>;
export const PRISMA_TRANSACTOR = Symbol("PrismaTransactor");
