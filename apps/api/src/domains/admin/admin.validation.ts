import { BadRequestException } from "@nestjs/common";

/** Accept explicit editable key settings, never credentials, scopes or usage counters. */
export function keySettings(body: unknown): Record<string, any> {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new BadRequestException("Expected settings object");
  const output: Record<string, any> = {};
  for (const [field, value] of Object.entries(body)) {
    if (["name", "description"].includes(field)) {
      if (typeof value !== "string" || value.length > 250 || (field === "name" && !value.trim()))
        throw new BadRequestException("Invalid " + field);
      output[field] = value.trim();
    } else if (["canRead", "canWrite", "isActive", "requireHttps"].includes(field)) {
      if (typeof value !== "boolean") throw new BadRequestException("Invalid " + field);
      output[field] = value;
    } else if (["minuteQuota", "hourQuota", "dailyQuota", "monthlyQuota"].includes(field)) {
      if (
        value !== null &&
        (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 2147483647)
      )
        throw new BadRequestException("Quota must be a positive integer or null");
      output[field] = value;
    } else if (
      [
        "ipRestrictions",
        "websiteOrigins",
        "allowedMethods",
        "allowedUserAgents",
        "blockedUserAgents",
      ].includes(field)
    ) {
      if (
        !Array.isArray(value) ||
        value.length > 100 ||
        value.some((v) => typeof v !== "string" || !v || v.length > 250)
      )
        throw new BadRequestException("Invalid " + field);
      if (
        field === "allowedMethods" &&
        value.some((v) => !["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(v))
      )
        throw new BadRequestException("Invalid HTTP method");
      output[field] = JSON.stringify(value);
    } else if (field === "restrictionMode") {
      if (value !== "allow" && value !== "deny")
        throw new BadRequestException("Invalid restriction mode");
      output[field] = value;
    } else if (field === "expiresAt") {
      if (
        value !== null &&
        (typeof value !== "string" ||
          !Number.isFinite(Date.parse(value)) ||
          Date.parse(value) <= Date.now())
      )
        throw new BadRequestException("Expiration must be a future date or null");
      output[field] = value === null ? null : new Date(value);
    } else throw new BadRequestException("Unsupported setting: " + field);
  }
  return output;
}

/** Validate identifiers before they become database filters or storage commands. */
export function identifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 500)
    throw new BadRequestException("Invalid " + name);
  return value;
}
