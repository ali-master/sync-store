/**
 * Checks if the input is an object (not null, array, or function).
 * @param input
 */
export function isObject(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === "object" && !Array.isArray(input);
}
