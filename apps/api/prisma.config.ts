import { definePrismaConfig } from "prisma/config";
import { defineConfig } from "@prisma/orm-mongo/config";

export default definePrismaConfig({
  orm: defineConfig({
    contract: "./src/modules/db/contract.prisma",
    db: { connection: process.env.DATABASE_URL },
    migrations: { dir: "prisma/migrations" },
  }),
});
