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
  return userId.startsWith(marker) ? JSON.parse(userId.slice(marker.length))[0] : "default";
}

/** Keep existing data in the default project; reserve an unambiguous namespace for new projects. */
export function projectUser(projectId: string, userId: string): string {
  if (userId.startsWith(marker)) throw new BadRequestException("Reserved user identifier prefix");
  return projectId === "default" ? userId : marker + JSON.stringify([projectId, userId]);
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
