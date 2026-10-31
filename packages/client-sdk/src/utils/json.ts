/** Reject values that JSON would silently change before they enter the persistent write queue. */
export function assertJson(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || ancestors.has(value))
    throw new Error("Expected an acyclic JSON value");
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    throw new Error("Expected plain JSON objects");
  if (Object.getOwnPropertySymbols(value).length)
    throw new Error("JSON cannot contain symbol keys");
  ancestors.add(value);
  for (const child of Array.isArray(value) ? value : Object.values(value))
    assertJson(child, ancestors);
  ancestors.delete(value);
}
