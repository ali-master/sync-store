import task from "tasuku";
import { PrismaClient } from "@prisma/client";
// Seeds

process.env.NODE_ENV = "development";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function PruneDatabaseSeed(db: PrismaClient) {
  const args = process.argv.slice(2);
  // Exclude some seeds from the list
  const excluded: Array<string> = [];
  const isExcluded = (seed: string) => excluded.includes(seed);
  // Example: npm run db:seed:prune -- --exclude=keys
  if (args.includes("--exclude=keys")) {
    excluded.push("keys");
  }

  let shouldPruneAll: boolean = args.includes("--all") || true;
  // Example: npm run db:seed:prune -- --keys
  if (args.includes("--keys")) {
    // await PruneUsersData(db);
    shouldPruneAll = false;
  }

  // Example: npm run db:seed:prune -- --all
  // Example: npm run db:seed:prune
  if (shouldPruneAll) {
    await task("Pruning all data", async ({ setTitle }) => {
      if (!isExcluded("keys")) {
        setTitle("Pruning keys...");
        // await PruneUsersData(db);
        setTitle("Pruned keys 🎉");
      }

      setTitle("Pruned all data successfully 🎉");
    });
  }
}
