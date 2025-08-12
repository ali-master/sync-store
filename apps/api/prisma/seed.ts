import * as env from "dotenv";
import { resolve } from "node:path";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@prisma/client";
// Seeds
import { PrepareDatabase } from "./seed/prepare";
import { PruneDatabaseSeed } from "./seed/prune";

env.config({ path: [resolve(process.cwd(), ".env"), resolve(process.cwd(), ".env.local")] });

process.env.NODE_ENV = "development";

const args = process.argv.slice(2);
const main = async () => {
  const adapter = new PrismaMariaDb({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
    user: process.env.DB_USERNAME || "root",
    password: process.env.DB_PASSWORD || "pass123",
    database: process.env.DB_DATABASE || "payment_gateway",
    ssl: process.env.DB_SSL === "true",
    timezone: "Asia/Tehran",
    autoJsonMap: true,
    bigIntAsNumber: true,
  });

  const db = new PrismaClient({
    adapter,
    errorFormat: "pretty",
  });

  try {
    // Prepare data in databases
    if (args.includes("--prepare")) {
      await PrepareDatabase(db);
    }
    // check args for seed data
    if (args.includes("--prune")) {
      await PruneDatabaseSeed(db);
    }
  } catch (e) {
    throw new Error(e as any);
  } finally {
    await db.$disconnect();
  }
};

main()
  .then(() => {
    console.log("Sync Store DB seeding completed successfully ✅");
    process.exit(0);
  })
  .catch((e) => {
    console.log(e);
    process.exit(1);
  });
