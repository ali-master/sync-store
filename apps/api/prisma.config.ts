import * as env from "dotenv";
import { expand } from "dotenv-expand";
import { resolve, join } from "node:path";
// Types
import type { PrismaConfig } from "prisma";

expand(
  env.config({
    path: [resolve(process.cwd(), ".env"), resolve(process.cwd(), ".env.local")],
  }),
);

export default {
  schema: join("prisma/schema"),
  experimental: {
    adapter: true,
    studio: true,
  },
  migrations: {
    seed: "npx ts-node --project ./prisma/tsconfig.json prisma/seed.ts",
  },
} satisfies PrismaConfig;
