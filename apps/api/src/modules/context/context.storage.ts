// Utilities
import { ClsServiceManager } from "nestjs-cls";
// Types
import type { AppContext, ContextStorage } from "@root/modules/context/context.type";

/**
 * Retrieves a reference to the underlying ClsService, which manages
 * microservice context data for the current request.
 * @template T - The type of data payload (if any) expected in the context.
 */
export function getContextRef<T = any>() {
  return ClsServiceManager.getClsService<AppContext<T>>();
}

/**
 * Stores a value in the context at the specified key, overwriting any existing value.
 * @param key - The context key at which to store the value.
 * @param value - The value to store.
 */
export function setContext(key: ContextStorage, value: any) {
  const cls = ClsServiceManager.getClsService<AppContext>();

  return cls.set(key, value);
}

/**
 * Sets a value in the context only if the key is undefined.
 * Does not overwrite existing values.
 * @param key - The context key to check and set.
 * @param value - The value to store if the key is not set.
 */
export function setIfUndefined(key: ContextStorage, value: any) {
  const cls = ClsServiceManager.getClsService<AppContext>();

  return cls.setIfUndefined(key, value);
}

/**
 * Retrieves the value associated with a given key from the context.
 * @param key - The context key to look up.
 */
export function getContextKey<R = any>(key: ContextStorage) {
  const cls = ClsServiceManager.getClsService<AppContext>();

  return cls.get<R>(key);
}

/**
 * Checks if the current context is active.
 * This can be useful to determine if the context is set up correctly
 * and ready for use.
 *
 * @returns True if the context is active, false otherwise.
 */
export function isContextActive() {
  const cls = ClsServiceManager.getClsService<AppContext>();

  return cls.isActive();
}

/**
 * Run the callback outside a shared CLS context
 * @param callback function to run
 * @returns whatever the callback returns
 * @template T - The type of the return value.
 */
export function outsideContext<T = any>(callback: () => T): T {
  const cls = ClsServiceManager.getClsService<AppContext>();

  return cls.exit(callback);
}

/**
 * Executes the provided callback within the current CLS context.
 * This is useful for ensuring that the context is preserved
 * during asynchronous operations.
 *
 * @template T - The type of the return value.
 * @param callback - The function to execute within the context.
 * @returns The result of the callback function.
 */
export function insideContext<T = any>(callback: () => T): T {
  const cls = ClsServiceManager.getClsService<AppContext>();

  return cls.run(callback);
}

/**
 * Checks if a context key exists in the current request context.
 * @param key The name of the context key to check.
 * @return True if the key exists, false otherwise.
 */
export function hasContextKey(key: ContextStorage) {
  const cls = ClsServiceManager.getClsService<AppContext>();

  return cls.has(key);
}

export function getInstanceId() {
  const cls = ClsServiceManager.getClsService<AppContext>();

  return cls.get("instanceId");
}

export function getUserId() {
  const cls = ClsServiceManager.getClsService<AppContext>();

  return cls.get("userId");
}

export function getIpAddress() {
  const cls = ClsServiceManager.getClsService<AppContext>();

  return cls.get("ip");
}

export function getUserAgent() {
  const cls = ClsServiceManager.getClsService<AppContext>();

  return cls.get("userAgent");
}

export function getApiKey() {
  const cls = ClsServiceManager.getClsService<AppContext>();

  return cls.get("apiKey");
}
