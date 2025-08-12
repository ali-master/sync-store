// Decorators
import { Injectable } from "@nestjs/common";
// Services
import { ClsService } from "nestjs-cls";
// Types
import type { AppContext, ContextStorage } from "@root/modules/context/context.type";

/**
 * The AppContextRepository class provides a structured way to store and retrieve
 * contextual custom data throughout a request lifecycle.
 * By using `nestjs-cls`, we maintain a shared context accessible from any part of the code
 * during the request.
 *
 * @template T - The type of the data payload stored in the App context.
 */
@Injectable()
export class ContextRepository<T = unknown> {
  constructor(private readonly cls: ClsService<AppContext<T>>) {}

  /**
   * Exposes the underlying ClsService reference directly.
   * Enables low-level control over the context if needed.
   */
  get ref() {
    return this.cls;
  }

  /**
   * Stores a value in the context at the specified key.
   * Overwrites any existing value for that key.
   *
   * @param key - The name of the context key.
   * @param value - The value to store.
   */
  set(key: ContextStorage<T>, value: any) {
    return this.cls.set(key, value);
  }

  /**
   * Stores a value in the context at the specified key only if
   * that key does not yet exist. Does nothing if the key is already set.
   *
   * @param key - The name of the context key.
   * @param value - The value to store if key is undefined.
   */
  setIfUndefined(key: ContextStorage<T>, value: any) {
    return this.cls.setIfUndefined(key, value);
  }

  /**
   * Checks if a context key exists in the current request context.
   * @param key The name of the context key to check.
   * @return True if the key exists, false otherwise.
   */
  has(key: ContextStorage<T>) {
    return this.cls.has(key);
  }

  /**
   * Run the callback outside a shared CLS context
   * This is useful for executing code that should not be affected by the current context.
   *
   * @template T - The type of the return value.
   * @param callback function to run
   * @returns whatever the callback returns
   */
  outside<T = any>(callback: () => T): T {
    return this.cls.exit(callback);
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
  inside<T = any>(callback: () => T): T {
    return this.cls.run(callback);
  }

  /**
   * Checks if the current context is active.
   * This can be useful to determine if the context is set up correctly
   * and ready for use.
   *
   * @returns True if the context is active, false otherwise.
   */
  isActive() {
    return this.cls.isActive();
  }

  /**
   * Retrieves the value currently associated with a context key.
   *
   * @param key - The name of the context key.
   */
  get<R = any>(key: ContextStorage<T>) {
    return this.cls.get<R>(key);
  }
}
