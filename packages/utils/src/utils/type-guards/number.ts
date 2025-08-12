import { Decimal } from "decimal.js";

/**
 * Checks if the input is a number.
 * @param input
 */
export function isNumber(input: unknown): input is number {
  return typeof input === "number" && !Number.isNaN(input);
}

/**
 * Checks if the input is a native number (not NaN or Infinity).
 * @param input
 */
export function isNativeNumber(input: unknown): input is number {
  return typeof input === "number" && Number.isFinite(input);
}

/**
 * Checks if the input is a Decimal instance.
 * @param input
 */
export function isDecimal(input: unknown): input is Decimal {
  return input instanceof Decimal;
}
