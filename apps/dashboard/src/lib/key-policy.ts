export const quotaPeriods = ["minute", "hour", "daily", "monthly"] as const;
export const listFields = [
  "ipRestrictions",
  "websiteOrigins",
  "allowedUserAgents",
  "blockedUserAgents",
] as const;
export const httpMethods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

/** Preserve local wall time when displaying a stored expiry. */
export function localExpiry(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** Translate human-readable fields into the existing administration API contract. */
export function readKeyPolicy(data: FormData, previousExpiry: string | null = null) {
  const policy: Record<string, unknown> = {};
  if (data.has("projectId"))
    policy.access = {
      projectId: String(data.get("projectId")),
      readPrefixes: String(data.get("readPrefixes") ?? "")
        .split(/\r?\n/)
        .map((v) => v.trim())
        .filter(Boolean),
      writePrefixes: String(data.get("writePrefixes") ?? "")
        .split(/\r?\n/)
        .map((v) => v.trim())
        .filter(Boolean),
    };
  for (const period of quotaPeriods) {
    const field = period + "Quota";
    const raw = String(data.get(field) ?? "").trim();
    const value = raw === "" ? null : Number(raw);
    if (value !== null && (!Number.isInteger(value) || value < 1 || value > 2147483647))
      throw new Error("Request limits must be whole numbers between 1 and 2,147,483,647.");
    policy[field] = value;
  }
  for (const field of listFields) {
    const values = String(data.get(field) ?? "")
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (values.length > 100 || values.some((item) => item.length > 250))
      throw new Error("Use up to 100 rules per field, with no more than 250 characters per rule.");
    policy[field] = values;
  }
  policy.allowedMethods = data.getAll("allowedMethods");
  policy.restrictionMode = data.get("restrictionMode") || "allow";
  policy.requireHttps = data.has("requireHttps");
  const expiry = String(data.get("expiresAt") ?? "");
  // Unchanged expired keys can still have their other settings edited.
  if (!previousExpiry || expiry !== localExpiry(previousExpiry)) {
    const date = expiry ? new Date(expiry) : null;
    if (date && (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()))
      throw new Error("Choose an expiration date in the future.");
    policy.expiresAt = date?.toISOString() ?? null;
  }
  return policy;
}
