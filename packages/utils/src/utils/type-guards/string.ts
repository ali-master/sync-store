/**
 * Checks if the input is a string.
 * @param input
 */
export function isString(input: unknown): input is string {
  return typeof input === "string";
}
