import { Database } from "../src/modules/db/db.client";
import { BOOTSTRAP_KEY_ID } from "../src/domains/admin/bootstrap-key";

// Local operator access only; never expose this recovery command through HTTP.
const db = new Database();
try {
  await db.onModuleInit();
  const record = await db.orm.api_keys.where({ id: BOOTSTRAP_KEY_ID }).first();
  if (!record)
    throw new Error("Complete first-time setup at /dashboard/ to create the administrator");
  console.log(record.key);
} finally {
  await db.onApplicationShutdown();
}
