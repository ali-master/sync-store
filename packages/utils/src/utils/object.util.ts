// Minimal object utility functions
export function getKeys<T extends Record<string, any>>(obj: T): (keyof T)[] {
  return Object.keys(obj) as (keyof T)[];
}

export function getValues<T extends Record<string, any>>(obj: T): T[keyof T][] {
  return Object.values(obj);
}
