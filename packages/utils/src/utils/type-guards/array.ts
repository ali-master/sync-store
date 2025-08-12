/**
 * Returns `true` if the input is of type `array`.
 * @param input
 */
export function isArray(input: unknown): input is unknown[] {
  return Array.isArray(input);
}
