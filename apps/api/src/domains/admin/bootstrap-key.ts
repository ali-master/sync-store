import { randomBytes } from "node:crypto";
import { apiKeyData } from "../../modules/db/api-key-data";
import type { Database } from "../../modules/db/db.client";

export const BOOTSTRAP_KEY_ID = "sync-store-bootstrap-admin";

/** Atomically create the installation's administrator; only the winning startup reveals it. */
export async function ensureBootstrapKey(
  db: Database,
  name = "Installation administrator",
): Promise<string | null> {
  if (await db.orm.api_keys.where({ id: BOOTSTRAP_KEY_ID }).first()) return null;
  const key = "ss_admin_" + randomBytes(32).toString("hex");
  try {
    await db.orm.api_keys.create({
      ...apiKeyData(name, key),
      id: BOOTSTRAP_KEY_ID,
      canWrite: true,
      scopes: '["admin","analytics:read"]',
      allowedMethods: '["GET","POST","PUT","PATCH","DELETE"]',
    });
    return key;
  } catch (error) {
    // A concurrent startup may have won the unique-ID insert; never replace its key.
    if (await db.orm.api_keys.where({ id: BOOTSTRAP_KEY_ID }).first()) return null;
    throw error;
  }
}
