/**
 * Type guard that checks if the given input is an Error object.
 *
 * @example
 * ```typescript
 * declare const maybeErr: Error | string;
 *
 * if (isError(maybeErr)) {
 *   // `maybeErr` is now typed as `Error`
 *   console.error(maybeErr.message);
 * } else {
 *   // `maybeErr` is now typed as `string`
 *   console.log(maybeErr);
 * }
 * ```
 *
 * @param input - The value to check.
 * @returns `true` if `value` is an Error object, otherwise `false`.
 */
export const isError = (input: unknown): input is Error => {
  return input instanceof Error;
};
