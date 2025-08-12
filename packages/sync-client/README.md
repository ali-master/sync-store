# 📦 @usex/sync-client

> Browser-first client library for real-time synchronized storage

[![npm version](https://img.shields.io/npm/v/@usex/sync-client.svg)](https://www.npmjs.com/package/@usex/sync-client)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/@usex/sync-client)](https://bundlephobia.com/package/@usex/sync-client)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

## 🎯 Overview

`@usex/sync-client` is a lightweight, type-safe client library that enables real-time data synchronization across browser instances. It provides a familiar localStorage-like API with automatic syncing capabilities, offline support, and React hooks for seamless integration.

## ✨ Features

- 🔄 **Real-time Synchronization** - Instant updates across all connected clients
- 💾 **LocalStorage Fallback** - Works offline with automatic sync when reconnected
- ⚛️ **React Hooks** - First-class React integration with reactive state
- 📦 **Tiny Bundle** - Minimal footprint with tree-shaking support
- 🛡️ **Type Safety** - Full TypeScript support with comprehensive types
- 🔌 **Auto-reconnection** - Handles network interruptions gracefully
- 🎯 **Event-driven** - Subscribe to storage changes with event listeners
- 🚀 **Zero Configuration** - Works out of the box with sensible defaults

## 📦 Installation

```bash
# npm
npm install @usex/sync-client

# yarn
yarn add @usex/sync-client

# pnpm
pnpm add @usex/sync-client
```

## 🚀 Quick Start

### Basic Usage

```typescript
import { createRemoteStorage } from '@usex/sync-client';

// Create storage instance
const storage = createRemoteStorage({
  serverUrl: 'http://localhost:3000',
  userId: 'user123'
});

// Store data (automatically synced)
await storage.setItem('theme', 'dark');
await storage.setItem('settings', {
  language: 'en',
  notifications: true
});

// Retrieve data
const theme = storage.getItem('theme'); // 'dark'
const settings = storage.getItem('settings'); // { language: 'en', ... }

// Remove data
await storage.removeItem('theme');

// Listen for changes
storage.on('change', (event) => {
  console.log(`${event.key} changed:`, {
    old: event.oldValue,
    new: event.newValue,
    source: event.source // 'local' or 'remote'
  });
});
```

### React Integration

```tsx
import { useRemoteStorage, useStorageItem } from '@usex/sync-client';

function App() {
  // Initialize storage
  const storage = useRemoteStorage({
    serverUrl: 'http://localhost:3000',
    userId: 'user123'
  });

  // Use reactive storage items
  const [theme, setTheme] = useStorageItem('theme', 'light');
  const [user, setUser] = useStorageItem('user', null);
  const [settings, setSettings] = useStorageItem('settings', {
    notifications: true
  });

  return (
    <div className={theme}>
      <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
        Toggle Theme
      </button>
      
      <div>
        {storage.isConnected ? '✅ Synced' : '⏳ Offline'}
      </div>
      
      <input
        placeholder="Username"
        value={user?.name || ''}
        onChange={(e) => setUser({ ...user, name: e.target.value })}
      />
    </div>
  );
}
```

### Advanced React Hooks

```tsx
import { 
  useRemoteStorage,
  useStorageItem,
  useStorageKeys,
  useStorageLength 
} from '@usex/sync-client';

function Dashboard() {
  const storage = useRemoteStorage({
    serverUrl: 'http://localhost:3000',
    userId: 'user123'
  });

  // Get all storage keys
  const keys = useStorageKeys(storage);
  
  // Get storage size
  const itemCount = useStorageLength(storage);
  
  // Use multiple storage items
  const [cart, setCart] = useStorageItem('cart', []);
  const [wishlist, setWishlist] = useStorageItem('wishlist', []);

  // Batch operations
  const clearUserData = async () => {
    await Promise.all([
      storage.removeItem('cart'),
      storage.removeItem('wishlist'),
      storage.removeItem('preferences')
    ]);
  };

  return (
    <div>
      <h2>Storage Stats</h2>
      <p>Total items: {itemCount}</p>
      <p>Keys: {keys.join(', ')}</p>
      
      <h3>Shopping Cart ({cart.length})</h3>
      <button onClick={() => setCart([...cart, { id: Date.now() }])}>
        Add Item
      </button>
      
      <button onClick={clearUserData}>
        Clear All Data
      </button>
    </div>
  );
}
```

## 📖 API Reference

### `createRemoteStorage(config)`

Creates a new RemoteStorage instance.

```typescript
const storage = createRemoteStorage({
  serverUrl?: string;      // Server URL (default: 'http://localhost:3000')
  userId: string;          // Unique user identifier (required)
  instanceId?: string;     // Instance ID (auto-generated)
  autoConnect?: boolean;   // Auto-connect on init (default: true)
  reconnection?: boolean;  // Enable auto-reconnection (default: true)
  timeout?: number;        // Connection timeout in ms (default: 5000)
});
```

### Storage Methods

#### `setItem(key: string, value: any, metadata?: object): Promise<void>`
Store or update an item with optional metadata.

```typescript
await storage.setItem('user', { name: 'John' }, { 
  timestamp: Date.now() 
});
```

#### `getItem(key: string): any`
Retrieve an item from storage.

```typescript
const user = storage.getItem('user');
```

#### `removeItem(key: string): Promise<void>`
Remove an item from storage.

```typescript
await storage.removeItem('user');
```

#### `clear(): void`
Clear all items for the current user.

```typescript
storage.clear();
```

#### `getAllItems(): Promise<StorageItem[]>`
Get all stored items.

```typescript
const items = await storage.getAllItems();
// [{ key: 'user', value: {...}, metadata: {...} }, ...]
```

#### `getAllKeys(): string[]`
Get all storage keys.

```typescript
const keys = storage.getAllKeys();
// ['user', 'theme', 'settings']
```

### Event Handling

#### `on(event: StorageEventType, listener: Function): void`
Subscribe to storage events.

```typescript
storage.on('change', (event) => {
  console.log('Storage changed:', event);
});

storage.on('connect', () => {
  console.log('Connected to server');
});

storage.on('disconnect', () => {
  console.log('Disconnected from server');
});

storage.on('error', (error) => {
  console.error('Storage error:', error);
});
```

#### `off(event: StorageEventType, listener?: Function): void`
Unsubscribe from events.

```typescript
storage.off('change', changeHandler);
// Or remove all listeners for an event
storage.off('change');
```

### Connection Management

#### `connect(): Promise<void>`
Manually connect to the server.

```typescript
await storage.connect();
```

#### `disconnect(): void`
Disconnect from the server.

```typescript
storage.disconnect();
```

#### `isOnline(): boolean`
Check connection status.

```typescript
if (storage.isOnline()) {
  console.log('Connected');
}
```

#### `waitForConnection(): Promise<void>`
Wait for connection to be established.

```typescript
await storage.waitForConnection();
console.log('Now connected');
```

## 🎣 React Hooks

### `useRemoteStorage(config)`
Initialize and manage storage connection.

```typescript
const storage = useRemoteStorage({
  serverUrl: 'http://localhost:3000',
  userId: 'user123'
});
```

### `useStorageItem(key, defaultValue)`
Reactive storage item with automatic updates.

```typescript
const [value, setValue] = useStorageItem('key', 'default');
```

### `useStorageKeys(storage)`
Get all storage keys reactively.

```typescript
const keys = useStorageKeys(storage);
```

### `useStorageLength(storage)`
Get storage item count reactively.

```typescript
const count = useStorageLength(storage);
```

## 🔧 Advanced Configuration

### Custom Instance ID
```typescript
const storage = createRemoteStorage({
  userId: 'user123',
  instanceId: 'desktop-app', // Identify different app instances
});
```

### Offline-First Mode
```typescript
const storage = createRemoteStorage({
  userId: 'user123',
  autoConnect: false, // Start offline
  reconnection: true  // Auto-reconnect when online
});

// Connect when ready
if (navigator.onLine) {
  await storage.connect();
}
```

### Error Handling
```typescript
storage.on('error', (error) => {
  if (error.type === 'connection') {
    console.log('Connection failed:', error.message);
  } else if (error.type === 'sync') {
    console.log('Sync failed:', error.message);
  }
});
```

## 📊 TypeScript Support

```typescript
interface User {
  id: string;
  name: string;
  email: string;
}

// Type-safe storage
const storage = createRemoteStorage({
  userId: 'user123'
});

// With type inference
const [user, setUser] = useStorageItem<User>('user', null);

// Type-safe event handling
storage.on('change', (event: {
  key: string;
  oldValue: any;
  newValue: any;
  source: 'local' | 'remote';
}) => {
  // Handle change
});
```

## 🏗️ Architecture

The client uses a layered architecture:

1. **Storage Layer** - LocalStorage with namespacing
2. **Sync Layer** - WebSocket communication via Socket.io
3. **Event Layer** - Event emitter for reactive updates
4. **React Layer** - Hooks for framework integration

## 🧪 Testing

```bash
# Run tests
pnpm test

# Watch mode
pnpm test:watch

# Coverage
pnpm test:cov
```

## 📦 Bundle Size

| Format | Size | Gzipped |
|--------|------|---------|
| ESM | ~12kb | ~4kb |
| CJS | ~13kb | ~4.5kb |
| UMD | ~15kb | ~5kb |

## 🤝 Contributing

We welcome contributions! Please see the main [Contributing Guide](../../CONTRIBUTING.md).

## 📄 License

Apache License 2.0 - see [LICENSE](../../LICENSE) for details.

## 🔗 Links

- [GitHub Repository](https://github.com/yourusername/sync-store)
- [NPM Package](https://www.npmjs.com/package/@usex/sync-client)
- [Documentation](https://sync-store.usestrict.dev)
- [Examples](../../examples)

---

Built with ❤️ by [Ali Torki](https://github.com/alitorki)