import task from "tasuku";
import { PrismaClient } from "@prisma/client";
// Seeds
import { PrepareMain } from "./main";

export async function PrepareDatabase(db: PrismaClient) {
  const args = process.argv.slice(2);

  // Exclude some seeds from the list
  const excluded: Array<string> = [];
  const isExcluded = (seed: string) => excluded.includes(seed);
  // Example: npm run db:seed:prepare -- --exclude=main
  if (args.includes("--exclude=main")) {
    excluded.push("main");
  }

  let shouldPrepareAll: boolean = args.includes("--all") || true;
  // Example: npm run db:seed:prepare -- --main
  if (args.includes("--main")) {
    await PrepareMain(db);
    shouldPrepareAll = false;
  }

  // Example: npm run db:seed:prepare -- --all
  // Example: npm run db:seed:prepare
  if (shouldPrepareAll) {
    await task("Preparing all data", async ({ setTitle }) => {
      if (!isExcluded("main")) {
        await PrepareMain(db);
      }

      setTitle("Prepared all data 🎉");
    });
  }
}
