import { BadRequestException } from "@nestjs/common";

export interface AccessPolicy {
  projectId: string;
  readPrefixes: string[];
  writePrefixes: string[];
}
export const defaultPolicy: AccessPolicy = {
  projectId: "default",
  readPrefixes: [],
  writePrefixes: [],
};
const marker = "project:";

/** Recover the server-owned project namespace for metadata-only operational reporting. */
export function storageProject(userId: string): string {
  const local = userId
    .replace(/^tenant:[a-zA-Z0-9_-]+:/, "")
    .replace(/^branch:[a-zA-Z0-9._/-]+:/, "");
  return local.startsWith(marker) ? JSON.parse(local.slice(marker.length))[0] : "default";
}

/** Ownership is encoded only by the server, never accepted from application identities. */
export function storageTenant(userId: string): string {
  return /^tenant:([a-zA-Z0-9_-]+):/.exec(userId)?.[1] ?? "default";
}

export function branchName(value: unknown = "main"): string {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,79}$/.test(value) ||
    value.includes("..") ||
    value.includes("//") ||
    value.endsWith("/")
  )
    throw new BadRequestException("Invalid branch name");
  return value;
}

/** Branches share one user-owned commit graph without crossing a tenant or project boundary. */
export function versionScope(userId: string) {
  const tenant = /^tenant:[a-zA-Z0-9_-]+:/.exec(userId)?.[0] ?? "";
  const rest = userId.slice(tenant.length);
  const branch = /^branch:([a-zA-Z0-9._/-]+):/.exec(rest);
  return {
    owner: tenant + (branch ? rest.slice(branch[0].length) : rest),
    branch: branch?.[1] ?? "main",
  };
}

export function branchUser(owner: string, name: string) {
  branchName(name);
  if (name === "main") return owner;
  const tenant = /^tenant:[a-zA-Z0-9_-]+:/.exec(owner)?.[0] ?? "";
  return tenant + "branch:" + name + ":" + owner.slice(tenant.length);
}

/** Keep existing data in the default project; reserve an unambiguous namespace for new projects. */
export function projectUser(
  projectId: string,
  userId: string,
  tenantId = "default",
  branch = "main",
): string {
  if (/^(project|tenant|branch):/.test(userId))
    throw new BadRequestException("Reserved user identifier prefix");
  const owner =
    (tenantId === "default" ? "" : `tenant:${tenantId}:`) +
    (projectId === "default" ? userId : marker + JSON.stringify([projectId, userId]));
  return branchUser(owner, branch);
}

/** Policies are stored in the existing JSON metadata field, avoiding a parallel source of truth. */
export function accessPolicy(record: { metadata?: string | null }): AccessPolicy {
  return { ...defaultPolicy, ...JSON.parse(record.metadata || "{}").access };
}

/** Prefixes are literal and case sensitive; an empty list leaves that permission unrestricted. */
export function permits(policy: AccessPolicy, key: string, reading: boolean): boolean {
  const prefixes = reading ? policy.readPrefixes : policy.writePrefixes;
  return prefixes.length === 0 || prefixes.some((prefix) => key.startsWith(prefix));
}

/** Validate administrator input before persisting any project binding or path restriction. */
export function validateAccess(value: unknown): AccessPolicy {
  const data = value as AccessPolicy;
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    Object.keys(data).some(
      (key) => !["projectId", "readPrefixes", "writePrefixes"].includes(key),
    ) ||
    typeof data.projectId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(data.projectId)
  )
    throw new BadRequestException("Invalid project access policy");
  for (const field of ["readPrefixes", "writePrefixes"] as const)
    if (
      !Array.isArray(data[field]) ||
      data[field].length > 100 ||
      data[field].some(
        (prefix) =>
          typeof prefix !== "string" || !prefix || prefix.length > 250 || prefix.includes("*"),
      )
    )
      throw new BadRequestException("Use literal key prefixes without wildcard characters");
  return data;
}
