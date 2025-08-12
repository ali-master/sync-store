/**
 * Checks if the input is a function.
 * @param input
 */
export function isFunction(input: unknown): input is Function {
  return typeof input === "function";
}
