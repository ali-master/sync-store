import { ConnectionState, NetworkConfig } from "../types";
import { EventEmitter } from "./event-emitter";

/**
 * Simple connection state management
 */
export class NetworkManager extends EventEmitter<{
  "state-change": ConnectionState;
  "reconnect-attempt": { attempt: number; delay: number };
}> {
  private currentState = ConnectionState.DISCONNECTED;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private baseReconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private reconnectTimeout?: NodeJS.Timeout;

  // Config properties
  private readonly backgroundSync: boolean;
  private readonly backgroundInterval: number;

  constructor(config?: NetworkConfig) {
    super();

    // Assign config properties with defaults
    this.backgroundSync = config?.backgroundSync ?? false;
    this.backgroundInterval = config?.backgroundInterval ?? 30000;

    // Listen for browser online/offline events
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.handleOnline.bind(this));
      window.addEventListener("offline", this.handleOffline.bind(this));
    }
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.currentState;
  }

  /**
   * Update connection state
   */
  setState(state: ConnectionState): void {
    if (this.currentState !== state) {
      this.currentState = state;
      void this.emit("state-change", state);

      // Reset reconnect attempts on successful connection
      if (state === ConnectionState.CONNECTED) {
        this.reconnectAttempts = 0;
        this.clearReconnectTimeout();
      }
    }
  }

  /**
   * Schedule reconnection attempt with exponential backoff
   */
  scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }

    const delay = this.calculateReconnectDelay();
    this.reconnectAttempts++;

    void this.emit("reconnect-attempt", { attempt: this.reconnectAttempts, delay });

    this.reconnectTimeout = setTimeout(() => {
      this.setState(ConnectionState.CONNECTING);
    }, delay);
  }

  /**
   * Calculate reconnection delay with exponential backoff and jitter
   */
  private calculateReconnectDelay(): number {
    const exponentialDelay = this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    const jitteredDelay = exponentialDelay * (0.5 + Math.random() * 0.5);
    return Math.min(jitteredDelay, this.maxReconnectDelay);
  }

  /**
   * Handle browser online event
   */
  private handleOnline(): void {
    this.setState(ConnectionState.CONNECTING);
  }

  /**
   * Handle browser offline event
   */
  private handleOffline(): void {
    this.setState(ConnectionState.DISCONNECTED);
  }

  /**
   * Clear reconnect timeout
   */
  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }
  }

  /**
   * Check if currently online (basic browser check)
   */
  isOnline(): boolean {
    return typeof navigator !== "undefined" ? navigator.onLine : true;
  }

  /**
   * Get simple quality info based on connection state
   */
  getQuality(): { isOnline: boolean; state: ConnectionState } {
    return {
      isOnline: this.isOnline(),
      state: this.currentState,
    };
  }

  /**
   * Check if background sync is enabled
   */
  isBackgroundSyncEnabled(): boolean {
    return this.backgroundSync;
  }

  /**
   * Get background sync interval
   */
  getBackgroundSyncInterval(): number {
    return this.backgroundInterval;
  }

  /**
   * Get network configuration
   */
  getConfig(): NetworkConfig {
    return {
      backgroundSync: this.backgroundSync,
      backgroundInterval: this.backgroundInterval,
    };
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.clearReconnectTimeout();

    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.handleOnline.bind(this));
      window.removeEventListener("offline", this.handleOffline.bind(this));
    }

    this.removeAllListeners();
  }
}
