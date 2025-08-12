/**
 * Checks if the input is a boolean.
 * @param input
 */
export function isBoolean(input: unknown): input is boolean {
  return typeof input === "boolean";
}
