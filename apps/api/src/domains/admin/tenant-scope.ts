import { ForbiddenException } from "@nestjs/common";
import { storageTenant } from "../sync-storage/services/access-policy";

/** Null denotes the platform administrator; tenant administrators never choose their scope. */
export type AdminTenant = string | null;

export function tenantFilter(resource: string, tenant: AdminTenant): Record<string, any> {
  if (!tenant) return {};
  if (["tenants"].includes(resource))
    throw new ForbiddenException("Platform administrator required");
  if (["keys", "projects", "saved_reports"].includes(resource)) return { tenantId: tenant };
  return { userId: { $regex: "^tenant:" + tenant + ":" } };
}

/** Guessed record IDs and internal storage identities cannot bypass ownership checks. */
export function requireTenantUser(userId: string, tenant: AdminTenant) {
  if (tenant && storageTenant(userId) !== tenant)
    throw new ForbiddenException("Record belongs to another tenant");
}
