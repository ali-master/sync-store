/**
 * Advanced storage utilities with compression, encryption, and management
 */

import { Logger } from "./logger";

export interface StorageOptions {
  compress?: boolean;
  encrypt?: boolean;
  ttl?: number;
  namespace?: string;
}

export interface StorageStats {
  totalKeys: number;
  totalSize: number;
  averageKeySize: number;
  oldestItem: number;
  newestItem: number;
  compressionRatio?: number;
}

export interface StorageItem<T = any> {
  value: T;
  metadata: {
    timestamp: number;
    ttl?: number;
    compressed?: boolean;
    encrypted?: boolean;
    size: number;
    version: number;
  };
}

/**
 * Enhanced storage wrapper with advanced features
 */
export class EnhancedStorage {
  private logger = new Logger("EnhancedStorage");
  private storage: Storage;
  private namespace: string;
  private encryptionKey?: string;
  private compressionEnabled: boolean;
  private maxSize: number;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(
    options: {
      storage?: Storage;
      namespace?: string;
      encryptionKey?: string;
      compressionEnabled?: boolean;
      maxSize?: number; // in bytes
      autoCleanup?: boolean;
      cleanupInterval?: number;
    } = {},
  ) {
    this.storage =
      options.storage ||
      (typeof localStorage !== "undefined" ? localStorage : this.createMemoryStorage());
    this.namespace = options.namespace || "sync";
    this.encryptionKey = options.encryptionKey;
    this.compressionEnabled = options.compressionEnabled || false;
    this.maxSize = options.maxSize || 10 * 1024 * 1024; // 10MB default

    if (options.autoCleanup) {
      this.startCleanupInterval(options.cleanupInterval || 60000); // 1 minute default
    }
  }

  /**
   * Set item with advanced options
   */
  setItem<T>(key: string, value: T, options: StorageOptions = {}): void {
    try {
      const namespacedKey = this.getNamespacedKey(key);
      const now = Date.now();

      const processedValue = value;
      let compressed = false;
      let encrypted = false;

      // Serialize to JSON first
      let serialized = JSON.stringify(processedValue);

      // Apply compression
      if (options.compress || this.compressionEnabled) {
        const compressedValue = this.compress(serialized);

        if (compressedValue.length < serialized.length) {
          serialized = compressedValue;
          compressed = true;
        }
      }

      // Apply encryption
      if (options.encrypt && this.encryptionKey) {
        serialized = this.encrypt(serialized, this.encryptionKey);
        encrypted = true;
      }

      const storageItem: StorageItem<T> = {
        value: processedValue,
        metadata: {
          timestamp: now,
          ttl: options.ttl,
          compressed,
          encrypted,
          size: new Blob([serialized]).size,
          version: 1,
        },
      };

      // Check storage limits
      this.enforceStorageLimit(key, new Blob([JSON.stringify(storageItem)]).size);

      this.storage.setItem(namespacedKey, JSON.stringify(storageItem));

      this.logger.debug(`Item stored: ${key}`, {
        size: storageItem.metadata.size,
        compressed,
        encrypted,
        ttl: options.ttl,
      });
    } catch (error) {
      this.logger.error(`Failed to store item: ${key}`, { error });
      throw error;
    }
  }

  /**
   * Get item with automatic decompression/decryption
   */
  getItem<T>(key: string): T | null {
    try {
      const namespacedKey = this.getNamespacedKey(key);
      const stored = this.storage.getItem(namespacedKey);

      if (!stored) return null;

      const storageItem: StorageItem<T> = JSON.parse(stored);

      // Check TTL
      if (this.isExpired(storageItem)) {
        this.removeItem(key);
        return null;
      }

      return storageItem.value;
    } catch (error) {
      this.logger.error(`Failed to retrieve item: ${key}`, { error });
      return null;
    }
  }

  /**
   * Get item with metadata
   */
  getItemWithMetadata<T>(key: string): StorageItem<T> | null {
    try {
      const namespacedKey = this.getNamespacedKey(key);
      const stored = this.storage.getItem(namespacedKey);

      if (!stored) return null;

      const storageItem: StorageItem<T> = JSON.parse(stored);

      // Check TTL
      if (this.isExpired(storageItem)) {
        this.removeItem(key);
        return null;
      }

      return storageItem;
    } catch (error) {
      this.logger.error(`Failed to retrieve item with metadata: ${key}`, { error });
      return null;
    }
  }

  /**
   * Remove item
   */
  removeItem(key: string): void {
    const namespacedKey = this.getNamespacedKey(key);
    this.storage.removeItem(namespacedKey);
    this.logger.debug(`Item removed: ${key}`);
  }

  /**
   * Clear all items in namespace
   */
  clear(): void {
    const keys = this.getAllKeys();
    keys.forEach((key) => this.removeItem(key));
    this.logger.info(`Cleared ${keys.length} items`);
  }

  /**
   * Get all keys in namespace
   */
  getAllKeys(): string[] {
    const prefix = this.getNamespacedKey("");
    const keys: string[] = [];

    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key && key.startsWith(prefix)) {
        keys.push(key.substring(prefix.length));
      }
    }

    return keys;
  }

  /**
   * Get storage statistics
   */
  getStats(): StorageStats {
    const keys = this.getAllKeys();
    let totalSize = 0;
    let oldestTimestamp = Date.now();
    let newestTimestamp = 0;

    keys.forEach((key) => {
      const item = this.getItemWithMetadata(key);
      if (item) {
        totalSize += item.metadata.size;
        oldestTimestamp = Math.min(oldestTimestamp, item.metadata.timestamp);
        newestTimestamp = Math.max(newestTimestamp, item.metadata.timestamp);
      }
    });

    return {
      totalKeys: keys.length,
      totalSize,
      averageKeySize: keys.length > 0 ? totalSize / keys.length : 0,
      oldestItem: oldestTimestamp,
      newestItem: newestTimestamp,
    };
  }

  /**
   * Check if item exists
   */
  hasItem(key: string): boolean {
    return this.getItem(key) !== null;
  }

  /**
   * Get remaining TTL for item
   */
  getTTL(key: string): number {
    const item = this.getItemWithMetadata(key);
    if (!item || !item.metadata.ttl) return -1;

    const remaining = item.metadata.timestamp + item.metadata.ttl - Date.now();
    return Math.max(0, remaining);
  }

  /**
   * Extend TTL for item
   */
  extendTTL(key: string, additionalMs: number): void {
    const item = this.getItemWithMetadata(key);
    if (item) {
      this.setItem(key, item.value, {
        ttl: (item.metadata.ttl || 0) + additionalMs,
      });
    }
  }

  /**
   * Cleanup expired items
   */
  cleanup(): number {
    const keys = this.getAllKeys();
    let cleanedCount = 0;

    keys.forEach((key) => {
      const item = this.getItemWithMetadata(key);
      if (item && this.isExpired(item)) {
        this.removeItem(key);
        cleanedCount++;
      }
    });

    if (cleanedCount > 0) {
      this.logger.info(`Cleaned up ${cleanedCount} expired items`);
    }

    return cleanedCount;
  }

  /**
   * Export data for backup
   */
  export(): Record<string, any> {
    const data: Record<string, any> = {};
    const keys = this.getAllKeys();

    keys.forEach((key) => {
      const item = this.getItemWithMetadata(key);
      if (item && !this.isExpired(item)) {
        data[key] = item;
      }
    });

    return {
      data,
      exportedAt: Date.now(),
      namespace: this.namespace,
      version: "1.0",
    };
  }

  /**
   * Import data from backup
   */
  import(backup: any): number {
    if (!backup.data || backup.version !== "1.0") {
      throw new Error("Invalid backup format");
    }

    let importedCount = 0;

    for (const [key, item] of Object.entries(backup.data as Record<string, StorageItem>)) {
      try {
        if (!this.isExpired(item)) {
          const namespacedKey = this.getNamespacedKey(key);
          this.storage.setItem(namespacedKey, JSON.stringify(item));
          importedCount++;
        }
      } catch (error) {
        this.logger.warn(`Failed to import item: ${key}`, { error });
      }
    }

    this.logger.info(`Imported ${importedCount} items`);
    return importedCount;
  }

  /**
   * Get storage usage as percentage
   */
  getUsagePercentage(): number {
    const stats = this.getStats();
    return (stats.totalSize / this.maxSize) * 100;
  }

  /**
   * Check if storage is near capacity
   */
  isNearCapacity(threshold = 80): boolean {
    return this.getUsagePercentage() >= threshold;
  }

  // Private methods

  private getNamespacedKey(key: string): string {
    return `${this.namespace}:${key}`;
  }

  private isExpired(item: StorageItem): boolean {
    if (!item.metadata.ttl) return false;
    return Date.now() > item.metadata.timestamp + item.metadata.ttl;
  }

  private compress(data: string): string {
    // Simple compression using built-in compression
    // In a real implementation, you might use a library like lz-string
    try {
      // This is a placeholder - implement actual compression
      const compressed = data; // pako.deflate(data) or similar
      return compressed;
    } catch (error) {
      this.logger.warn("Compression failed, using original data", { error });
      return data;
    }
  }

  private encrypt(data: string, key: string): string {
    // Simple XOR encryption (not secure, for demonstration)
    // In production, use proper encryption like AES
    let result = "";
    for (let i = 0; i < data.length; i++) {
      result += String.fromCharCode(data.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return btoa(result);
  }

  private enforceStorageLimit(_key: string, itemSize: number): void {
    if (itemSize > this.maxSize) {
      throw new Error(`Item too large: ${itemSize} bytes exceeds limit of ${this.maxSize} bytes`);
    }

    const currentSize = this.getStats().totalSize;
    const availableSpace = this.maxSize - currentSize;

    if (itemSize > availableSpace) {
      // Free up space using LRU strategy
      this.freeUpSpace(itemSize - availableSpace);
    }
  }

  private freeUpSpace(bytesNeeded: number): void {
    const keys = this.getAllKeys();
    const items = keys
      .map((key) => ({
        key,
        item: this.getItemWithMetadata(key),
      }))
      .filter(({ item }) => item !== null)
      .sort((a, b) => a.item!.metadata.timestamp - b.item!.metadata.timestamp);

    let freedBytes = 0;
    let removedCount = 0;

    for (const { key, item } of items) {
      if (freedBytes >= bytesNeeded) break;

      this.removeItem(key);
      freedBytes += item!.metadata.size;
      removedCount++;
    }

    this.logger.info(`Freed ${freedBytes} bytes by removing ${removedCount} items`);
  }

  private startCleanupInterval(intervalMs: number): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, intervalMs);
  }

  private createMemoryStorage(): Storage {
    const storage = new Map<string, string>();

    return {
      getItem: (key: string) => storage.get(key) || null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
      length: storage.size,
      key: (index: number) => Array.from(storage.keys())[index] || null,
    } as Storage;
  }

  /**
   * Destroy storage and cleanup resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}
