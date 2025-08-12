// Minimal reflect utilities for metadata operations
export function getReflect<T = any>(target: any, propertyKey: string | symbol): T | undefined {
  return Reflect.get(target, propertyKey);
}

export function setReflect(target: any, propertyKey: string | symbol, value: any): boolean {
  return Reflect.set(target, propertyKey, value);
}

export function hasMetadata(metadataKey: any, target: any): boolean {
  return Reflect.hasMetadata && Reflect.hasMetadata(metadataKey, target);
}

export function getMetadata(metadataKey: any, target: any): any {
  return Reflect.getMetadata && Reflect.getMetadata(metadataKey, target);
}

export function setMetadata(metadataKey: any, metadataValue: any, target: any): void {
  if (Reflect.defineMetadata) {
    Reflect.defineMetadata(metadataKey, metadataValue, target);
  }
}
