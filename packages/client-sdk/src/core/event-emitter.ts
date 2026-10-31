import type { EventListener, UnsubscribeFn } from "../types";

/**
 * Type-safe event emitter with advanced features
 */
export class EventEmitter<TEvents extends Record<string, any> = Record<string, any>> {
  private listeners = new Map<keyof TEvents, Set<EventListener>>();
  private onceListeners = new Map<keyof TEvents, Set<EventListener>>();
  private maxListeners = 100;
  private debugMode = false;

  constructor(options?: { maxListeners?: number; debug?: boolean }) {
    if (options?.maxListeners) this.maxListeners = options.maxListeners;
    if (options?.debug) this.debugMode = options.debug;
  }

  /**
   * Add event listener
   */
  on<K extends keyof TEvents>(event: K, listener: EventListener<TEvents[K]>): UnsubscribeFn {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    const eventListeners = this.listeners.get(event)!;

    if (eventListeners.size >= this.maxListeners) {
      console.warn(`Maximum listeners (${this.maxListeners}) exceeded for event: ${String(event)}`);
    }

    eventListeners.add(listener);

    if (this.debugMode) {
      console.debug(`Event listener added for: ${String(event)}, total: ${eventListeners.size}`);
    }

    // Return unsubscribe function
    return () => this.off(event, listener);
  }

  /**
   * Add one-time event listener
   */
  once<K extends keyof TEvents>(event: K, listener: EventListener<TEvents[K]>): UnsubscribeFn {
    if (!this.onceListeners.has(event)) {
      this.onceListeners.set(event, new Set());
    }

    this.onceListeners.get(event)!.add(listener);

    if (this.debugMode) {
      console.debug(`Once listener added for: ${String(event)}`);
    }

    return () => {
      const onceEventListeners = this.onceListeners.get(event);
      if (onceEventListeners) {
        onceEventListeners.delete(listener);
      }
    };
  }

  /**
   * Remove event listener
   */
  off<K extends keyof TEvents>(event: K, listener?: EventListener<TEvents[K]>): void {
    if (!listener) {
      // Remove all listeners for event
      this.listeners.delete(event);
      this.onceListeners.delete(event);
      if (this.debugMode) {
        console.debug(`All listeners removed for: ${String(event)}`);
      }
      return;
    }

    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.delete(listener);
      if (eventListeners.size === 0) {
        this.listeners.delete(event);
      }
    }

    const onceEventListeners = this.onceListeners.get(event);
    if (onceEventListeners) {
      onceEventListeners.delete(listener);
      if (onceEventListeners.size === 0) {
        this.onceListeners.delete(event);
      }
    }

    if (this.debugMode) {
      console.debug(`Listener removed for: ${String(event)}`);
    }
  }

  /**
   * Emit event to all listeners
   */
  async emit<K extends keyof TEvents>(event: K, data: TEvents[K]): Promise<void> {
    if (this.debugMode) {
      console.debug(`Emitting event: ${String(event)}`, data);
    }

    const promises: Promise<void>[] = [];

    // Emit to regular listeners
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      for (const listener of eventListeners) {
        try {
          const result = listener(data);
          if (result instanceof Promise) {
            promises.push(result);
          }
        } catch (error) {
          console.error(`Error in event listener for ${String(event)}:`, error);
        }
      }
    }

    // Emit to once listeners and remove them
    const onceEventListeners = this.onceListeners.get(event);
    if (onceEventListeners) {
      for (const listener of onceEventListeners) {
        try {
          const result = listener(data);
          if (result instanceof Promise) {
            promises.push(result);
          }
        } catch (error) {
          console.error(`Error in once listener for ${String(event)}:`, error);
        }
      }
      this.onceListeners.delete(event);
    }

    // Wait for all async listeners
    if (promises.length > 0) {
      await Promise.allSettled(promises);
    }
  }

  /**
   * Emit event synchronously (non-async listeners only)
   */
  emitSync<K extends keyof TEvents>(event: K, data: TEvents[K]): void {
    if (this.debugMode) {
      console.debug(`Emitting sync event: ${String(event)}`, data);
    }

    // Emit to regular listeners
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      for (const listener of eventListeners) {
        try {
          listener(data);
        } catch (error) {
          console.error(`Error in sync event listener for ${String(event)}:`, error);
        }
      }
    }

    // Emit to once listeners and remove them
    const onceEventListeners = this.onceListeners.get(event);
    if (onceEventListeners) {
      for (const listener of onceEventListeners) {
        try {
          listener(data);
        } catch (error) {
          console.error(`Error in sync once listener for ${String(event)}:`, error);
        }
      }
      this.onceListeners.delete(event);
    }
  }

  /**
   * Get number of listeners for event
   */
  listenerCount<K extends keyof TEvents>(event: K): number {
    const regularCount = this.listeners.get(event)?.size || 0;
    const onceCount = this.onceListeners.get(event)?.size || 0;
    return regularCount + onceCount;
  }

  /**
   * Get all event names with listeners
   */
  eventNames(): Array<keyof TEvents> {
    const names = new Set<keyof TEvents>();

    for (const event of this.listeners.keys()) {
      names.add(event);
    }

    for (const event of this.onceListeners.keys()) {
      names.add(event);
    }

    return Array.from(names);
  }

  /**
   * Remove all listeners
   */
  removeAllListeners(): void {
    this.listeners.clear();
    this.onceListeners.clear();

    if (this.debugMode) {
      console.debug("All event listeners removed");
    }
  }

  /**
   * Set maximum number of listeners per event
   */
  setMaxListeners(max: number): void {
    this.maxListeners = max;
  }

  /**
   * Get maximum number of listeners per event
   */
  getMaxListeners(): number {
    return this.maxListeners;
  }

  /**
   * Enable/disable debug mode
   */
  setDebugMode(debug: boolean): void {
    this.debugMode = debug;
  }

  /**
   * Check if event has listeners
   */
  hasListeners<K extends keyof TEvents>(event: K): boolean {
    return this.listenerCount(event) > 0;
  }

  /**
   * Wait for a specific event to be emitted
   */
  waitFor<K extends keyof TEvents>(event: K, timeout?: number): Promise<TEvents[K]> {
    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout | undefined;

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
      };

      const unsubscribe = this.once(event, (data) => {
        cleanup();
        resolve(data);
      });

      if (timeout && timeout > 0) {
        timeoutId = setTimeout(() => {
          unsubscribe();
          reject(new Error(`Timeout waiting for event: ${String(event)}`));
        }, timeout);
      }
    });
  }

  /**
   * Create a filtered event emitter that only emits events matching a condition
   */
  filter<K extends keyof TEvents>(
    event: K,
    condition: (data: TEvents[K]) => boolean,
  ): EventEmitter<Pick<TEvents, K>> {
    const filteredEmitter = new EventEmitter<Pick<TEvents, K>>();

    this.on(event, (data) => {
      if (condition(data)) {
        filteredEmitter.emit(event, data);
      }
    });

    return filteredEmitter;
  }

  /**
   * Create a mapped event emitter that transforms event data
   */
  map<K extends keyof TEvents, U>(
    event: K,
    transform: (data: TEvents[K]) => U,
  ): EventEmitter<{ [P in K]: U }> {
    const mappedEmitter = new EventEmitter<{ [P in K]: U }>();

    this.on(event, (data) => {
      try {
        const transformed = transform(data);
        mappedEmitter.emit(event, transformed);
      } catch (error) {
        console.error(`Error transforming event data for ${String(event)}:`, error);
      }
    });

    return mappedEmitter;
  }
}
