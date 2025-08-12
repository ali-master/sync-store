import { Decimal } from "decimal.js";
import { getKeys } from "./object.util";
import { isArray, isDecimal, isNumber, isObject } from "./type-guards";
/**
 * For any type `T`:
 * - If it is `Decimal`, replace it with `V`.
 * - If it is an array, map its element type recursively.
 * - If it is an object, recursively transform each field.
 * - Otherwise, keep `T` as is.
 */
type DeepReplaceDecimal<T, V> = T extends Decimal
  ? V
  : T extends (infer U)[]
    ? DeepReplaceDecimal<U, V>[]
    : T extends object
      ? { [K in keyof T]: DeepReplaceDecimal<T[K], V> }
      : T;

/**
 * Recursively converts any Decimal fields in an object to JS numbers.
 * Assumes you have a helper function `isDecimal(value) => boolean` that detects
 * whether `value` is a Decimal.
 */
export function deepDecimalExplorer<T, V = string | number | Decimal>(
  input: T,
  toCallback: (input: Decimal) => V,
): DeepReplaceDecimal<T, V> {
  // If it's an array, process each element
  if (isArray(input)) {
    return input.map((input) => {
      if (isDecimal(input)) {
        return toCallback(input) as unknown as V;
      }

      return deepDecimalExplorer(input, toCallback);
    }) as DeepReplaceDecimal<T, V>;
  }

  // If it's an object, process each field
  if (input && isObject(input)) {
    const keys = getKeys(input);
    const cloned = {} as typeof keys;
    for (const key of keys) {
      const value = (input as any)[key];
      // Check if it's a Decimal instance
      if (isDecimal(value)) {
        (cloned as any)[key] = toCallback(value);
        // Recurse if it's an array or object
      } else if (isArray(value) || isObject(value)) {
        (cloned as any)[key] = deepDecimalExplorer(value, toCallback);
      } else {
        (cloned as any)[key] = value;
      }
    }

    return cloned as DeepReplaceDecimal<T, V>;
  }

  return input as DeepReplaceDecimal<T, V>;
}

/**
 * For any type T:
 * - If T is number or string, replace it with Decimal.
 * - If T is an array, map its element type recursively.
 * - If T is an object, recursively transform each field.
 * - Otherwise (e.g., boolean, null, undefined), keep T.
 */
type DeepDecimalify<T> = T extends number | string
  ? Decimal
  : T extends Array<infer U>
    ? DeepDecimalify<U>[]
    : T extends object
      ? { [K in keyof T]: DeepDecimalify<T[K]> }
      : T;

/**
 * Recursively converts every number or number's string in `input` to a DecimalJS instance,
 * preserving the overall shape. The return type is `DeepDecimalify<T>`.
 */
export function deepDecimalify<T>(input: T): DeepDecimalify<T> {
  // 1. If it's a primitive number or string, wrap in Decimal
  if (isNumber(input)) {
    return new Decimal(input) as DeepDecimalify<T>;
  }

  // 2. If it's an array, process each element recursively
  if (isArray(input)) {
    return input.map((elem) => deepDecimalify(elem)) as DeepDecimalify<T>;
  }

  // 3. If it's an object (and not null), convert fields
  if (input && isObject(input)) {
    const keys = getKeys(input);
    const cloned = {} as typeof keys;
    for (const key of keys) {
      const value = (input as any)[key];
      (cloned as any)[key] = deepDecimalify(value);
    }

    return cloned as DeepDecimalify<T>;
  }

  // 4. Otherwise (boolean, null, undefined, etc.), return as is
  return input as DeepDecimalify<T>;
}

export { Decimal };
