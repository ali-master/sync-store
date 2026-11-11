import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

// No database connection: fail the image build when generated storage has no
// migration path from any checked-in historical contract (including a fresh DB).
const apiRoot = resolve(import.meta.dir, "..");
const contract = JSON.parse(await readFile(resolve(apiRoot, "src/modules/db/contract.json"), "utf8"));
const target = contract.storage.storageHash as string;
const migrationsDir = resolve(import.meta.dir, "migrations/app");
const edges: { from: string | null; to: string }[] = [];
for (const entry of await readdir(migrationsDir, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name !== "refs") {
    edges.push(JSON.parse(await readFile(resolve(migrationsDir, entry.name, "migration.json"), "utf8")));
  }
}

if (!target || !edges.length) throw new Error("Missing storage hash or migration history");
const reachable = new Set<string | null>([target]);
let changed = true;
while (changed) {
  changed = false;
  for (const { from, to } of edges) {
    if (reachable.has(to) && !reachable.has(from)) {
      reachable.add(from);
      changed = true;
    }
  }
}
const historical = new Set<string | null>([null, ...edges.flatMap(({ from, to }) => [from, to])]);
const missing = [...historical].filter((hash) => !reachable.has(hash));
if (missing.length) {
  throw new Error(`No migration path to generated storage ${target} from: ${missing.join(", ")}. Check Prisma version compatibility or add a reviewed migration.`);
}
console.log(`Migration paths verified: ${historical.size} historical states reach ${target}`);
