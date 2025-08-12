/**
 * A dictionary type for any key: string, number, or symbol.
 * This is an "open" or "index signature" dictionary—meaning
 * it can have arbitrarily many keys of any allowable property type.
 *
 * @typeParam V - The type of each value stored in the dictionary.
 *
 * @example
 * ```typescript
 * // A dictionary of booleans keyed by string/number/symbol
 * const flags: OpenDictionary<boolean> = {
 *   "debug": true,
 *   42: false,
 *   [Symbol("hidden")]: true,
 * };
 * ```
 */
export type OpenDictionary<V = unknown> = {
  [key: string | number | symbol]: V;
};

/**
 * A "closed" dictionary type that uses a mapped type over a **specific set** of keys.
 * If you only want to allow certain key names or key values, use this version.
 *
 * @typeParam K - A union of valid property keys (string, number, symbol).
 * @typeParam V - The type of each value assigned to those keys.
 *
 * @example
 * ```typescript
 * // Restrict valid keys to only "name" and 123:
 * type FixedKeys = Dictionary<"name" | 123, string>;
 * const obj: FixedKeys = {
 *   name: "Alice",
 *   123: "some data",
 *   // Not allowed: extraKey: "???"  <-- Type error
 * };
 * ```
 */
export type Dictionary<K extends PropertyKey, V> = {
  [P in K]: V;
};

/**
 * A convenience type combining both concepts:
 * - Keys can be string | number | symbol
 * - Values of type T
 * This is effectively the same as `OpenDictionary<T>` but with defaults.
 *
 * @typeParam T - The type of each value stored.
 *
 * @example
 * ```typescript
 * // A dictionary with any possible key, holding strings
 * const dict: AnyDictionary<string> = {
 *   foo: "hello",
 *   100: "numeric key",
 *   [Symbol("bar")]: "symbolic key",
 * };
 * ```
 */
export type AnyDictionary<T = unknown> = Record<PropertyKey, T>;

/**
 * A "Union" dictionary type that maps each key to its own value type.
 * This is useful when you have a union of keys and want to ensure the value types are preserved.
 * It's similar to `Dictionary` but with a mapped type. It's also a way to "flatten" a nested dictionary.
 *
 * @typeParam T - A union of keys to their respective value types.
 * @example
 * ```typescript
 * // A dictionary with a known set of keys and their types
 * const arr = [1, 2, 3] as const;
 * type Data = UnionDictionary<typeof arr[number]>;
 * const data: Data = {
 *  0: 1,
 *  1: 2,
 *  2: 3,
 *  // Not allowed: extraKey: 4  <-- Type error
 * };
 * ```
 */
export type UnionDictionary<T> = {
  [K in keyof T]: T[K];
} & {};
