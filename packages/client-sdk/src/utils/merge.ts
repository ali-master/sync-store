/**
 * Deep merge utilities for conflict resolution and data merging
 */

/**
 * Check if value is a plain object
 */
export function isObject(obj: any): obj is Record<string, any> {
  return obj !== null && typeof obj === "object" && !Array.isArray(obj) && !(obj instanceof Date);
}

/**
 * Check if value is an array
 */
export function isArray(obj: any): obj is any[] {
  return Array.isArray(obj);
}

/**
 * Check if value is primitive
 */
export function isPrimitive(obj: any): boolean {
  return obj === null || obj === undefined || typeof obj !== "object";
}

/**
 * Deep merge two objects
 */
export function deepMerge<T extends Record<string, any>>(target: T, source: T): T {
  const result = { ...target };

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key];
      const targetValue = result[key];

      if (isObject(sourceValue) && isObject(targetValue)) {
        // Recursively merge nested objects
        result[key] = deepMerge(targetValue, sourceValue);
      } else if (isArray(sourceValue) && isArray(targetValue)) {
        // Merge arrays
        result[key] = mergeArrays(targetValue, sourceValue) as any;
      } else {
        // Overwrite primitive values
        result[key] = sourceValue;
      }
    }
  }

  return result;
}

/**
 * Shallow merge two objects
 */
export function shallowMerge<T extends Record<string, any>>(target: T, source: T): T {
  return { ...target, ...source };
}

/**
 * Merge two arrays with deduplication
 */
export function mergeArrays<T>(target: T[], source: T[]): T[] {
  const result = [...target];

  for (const item of source) {
    // Use JSON.stringify for deep comparison (not perfect but works for most cases)
    if (!result.some((existing) => JSON.stringify(existing) === JSON.stringify(item))) {
      result.push(item);
    }
  }

  return result;
}

/**
 * Merge arrays by index (replace existing items)
 */
export function mergeArraysByIndex<T>(target: T[], source: T[]): T[] {
  const result = [...target];

  for (let i = 0; i < source.length; i++) {
    if (i < result.length) {
      if (isObject(result[i]) && isObject(source[i])) {
        result[i] = deepMerge(result[i] as any, source[i] as any);
      } else {
        result[i] = source[i];
      }
    } else {
      result.push(source[i]);
    }
  }

  return result;
}

/**
 * Smart merge that attempts to preserve both values when possible
 */
export function smartMerge(local: any, remote: any): any {
  // Handle null/undefined
  if (local === null || local === undefined) return remote;
  if (remote === null || remote === undefined) return local;

  // Same values
  if (JSON.stringify(local) === JSON.stringify(remote)) {
    return local;
  }

  // Different types - prefer remote (assume it's newer)
  if (typeof local !== typeof remote) {
    return remote;
  }

  // Objects
  if (isObject(local) && isObject(remote)) {
    return deepMerge(local, remote);
  }

  // Arrays
  if (isArray(local) && isArray(remote)) {
    return mergeArrays(local, remote);
  }

  // Primitives - prefer remote
  return remote;
}

/**
 * Three-way merge (useful for advanced conflict resolution)
 */
export function threeWayMerge<T>(base: T, local: T, remote: T): T {
  // If local and remote are the same, return either
  if (JSON.stringify(local) === JSON.stringify(remote)) {
    return local;
  }

  // If local is unchanged from base, use remote
  if (JSON.stringify(local) === JSON.stringify(base)) {
    return remote;
  }

  // If remote is unchanged from base, use local
  if (JSON.stringify(remote) === JSON.stringify(base)) {
    return local;
  }

  // Both changed - attempt smart merge
  return smartMerge(local, remote);
}

/**
 * Merge with conflict detection
 */
export function mergeWithConflicts<T extends Record<string, any>>(
  local: T,
  remote: T,
): { result: T; conflicts: string[] } {
  const result = { ...local };
  const conflicts: string[] = [];

  for (const key in remote) {
    if (Object.prototype.hasOwnProperty.call(remote, key)) {
      const localValue = local[key];
      const remoteValue = remote[key];

      if (localValue === undefined) {
        // New key from remote
        result[key] = remoteValue;
      } else if (JSON.stringify(localValue) === JSON.stringify(remoteValue)) {
        // Same values, no conflict
        result[key] = remoteValue;
      } else if (isObject(localValue) && isObject(remoteValue)) {
        // Recursively merge objects
        const nestedMerge = mergeWithConflicts(localValue, remoteValue);
        result[key] = nestedMerge.result;

        // Add nested conflicts with path prefix
        nestedMerge.conflicts.forEach((conflict) => {
          conflicts.push(`${key}.${conflict}`);
        });
      } else {
        // Conflicting values
        conflicts.push(key);
        result[key] = remoteValue; // Prefer remote
      }
    }
  }

  return { result, conflicts };
}

/**
 * Custom merge function type
 */
export type MergeFunction<T = any> = (local: T, remote: T) => T;

/**
 * Create a custom merger with specific rules
 */
export function createCustomMerger<T extends Record<string, any>>(
  rules: Record<string, MergeFunction>,
): MergeFunction<T> {
  return (local: T, remote: T): T => {
    if (!isObject(local) || !isObject(remote)) {
      return smartMerge(local, remote);
    }

    const result = { ...local } as T;

    for (const key in remote) {
      if (Object.prototype.hasOwnProperty.call(remote, key)) {
        const customMerger = rules[key];

        if (customMerger) {
          result[key] = customMerger(local[key], remote[key]);
        } else {
          result[key] = smartMerge(local[key], remote[key]);
        }
      }
    }

    return result;
  };
}

/**
 * Merge arrays of objects by a key field
 */
export function mergeArraysByKey<T extends Record<string, any>>(
  local: T[],
  remote: T[],
  keyField: keyof T,
): T[] {
  const result = [...local];

  for (const remoteItem of remote) {
    const key = remoteItem[keyField];
    const existingIndex = result.findIndex((item) => item[keyField] === key);

    if (existingIndex >= 0) {
      // Merge existing item
      result[existingIndex] = deepMerge(result[existingIndex], remoteItem);
    } else {
      // Add new item
      result.push(remoteItem);
    }
  }

  return result;
}

/**
 * Get diff between two objects
 */
export function diff(local: any, remote: any): ObjectDiff {
  const changes: ObjectDiff = {
    added: {},
    modified: {},
    removed: {},
    unchanged: {},
  };

  if (!isObject(local) || !isObject(remote)) {
    if (local !== remote) {
      return {
        added: {},
        modified: { _root: { local, remote } },
        removed: {},
        unchanged: {},
      };
    }
    return changes;
  }

  // Check all keys in local
  for (const key in local) {
    if (Object.prototype.hasOwnProperty.call(local, key)) {
      if (!Object.prototype.hasOwnProperty.call(remote, key)) {
        changes.removed[key] = local[key];
      } else if (JSON.stringify(local[key]) === JSON.stringify(remote[key])) {
        changes.unchanged[key] = local[key];
      } else {
        changes.modified[key] = { local: local[key], remote: remote[key] };
      }
    }
  }

  // Check for added keys in remote
  for (const key in remote) {
    if (
      Object.prototype.hasOwnProperty.call(remote, key) &&
      !Object.prototype.hasOwnProperty.call(local, key)
    ) {
      changes.added[key] = remote[key];
    }
  }

  return changes;
}

export interface ObjectDiff {
  added: Record<string, any>;
  modified: Record<string, { local: any; remote: any }>;
  removed: Record<string, any>;
  unchanged: Record<string, any>;
}
