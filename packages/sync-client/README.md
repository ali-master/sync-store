# @usex/sync-client

A robust and flexible client-side communication layer for data synchronization, supporting both WebSocket and HTTP REST protocols with intelligent fallback mechanisms.

[![npm version](https://img.shields.io/npm/v/@usex/sync-client.svg)](https://www.npmjs.com/package/@usex/sync-client)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/@usex/sync-client)](https://bundlephobia.com/package/@usex/sync-client)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

## Features

- **Dual-Protocol Support**: Seamless integration with both WebSocket (real-time) and HTTP REST APIs
- **Flexible Transport Modes**: Choose between HTTP-only, WebSocket-only, or automatic mode with fallback
- **High Performance**: Low latency, efficient resource utilization, and built-in performance monitoring
- **Advanced Logging**: Colored console output with configurable log levels and performance metrics
- **Conflict Resolution**: Automatic and manual conflict resolution strategies
- **Offline Support**: Queue operations when offline and sync when connection is restored
- **React Hooks**: Ready-to-use React hooks for seamless integration
- **TypeScript Support**: Full TypeScript support with comprehensive type definitions

## Installation

```bash
npm install @usex/sync-client
# or
yarn add @usex/sync-client
# or
pnpm add @usex/sync-client
```

## Quick Start

```typescript
import { createRemoteStorage, TransportMode } from '@usex/sync-client';

// Create a sync client with automatic transport selection
const storage = createRemoteStorage({
  serverUrl: 'https://api.example.com',
  userId: 'user123',
  mode: TransportMode.AUTO, // Automatically select and fallback between WebSocket and HTTP
  apiKey: 'your-api-key'
});

// Connect to the server
await storage.connect();

// Store data
await storage.setItem('preferences', { theme: 'dark', language: 'en' });

// Retrieve data
const preferences = storage.getItem('preferences');

// Subscribe to real-time updates
await storage.subscribe(['preferences']);
storage.on('change', (event) => {
  console.log('Data changed:', event);
});
```

## Transport Modes

The sync client offers three transport modes to suit different requirements:

### HTTP Mode
Use HTTP REST exclusively for all communication. Best for:
- Environments where WebSocket is not available
- Simple request-response patterns
- Lower server resource requirements

```typescript
const storage = createRemoteStorage({
  mode: TransportMode.HTTP,
  serverUrl: 'https://api.example.com',
  userId: 'user123'
});
```

### WebSocket Mode
Use WebSocket exclusively for real-time bidirectional communication. Best for:
- Real-time collaborative applications
- Low-latency requirements
- Continuous data streaming

```typescript
const storage = createRemoteStorage({
  mode: TransportMode.WEBSOCKET,
  serverUrl: 'wss://api.example.com',
  userId: 'user123'
});
```

### Auto Mode (Recommended)
Intelligently selects transport with automatic fallback. Best for:
- Maximum reliability
- Seamless user experience
- Production environments

```typescript
const storage = createRemoteStorage({
  mode: TransportMode.AUTO, // Primary: WebSocket, Fallback: HTTP
  serverUrl: 'https://api.example.com',
  userId: 'user123'
});
```

## API Reference

### Core Methods

#### `setItem(key: string, value: any, metadata?: object): Promise<void>`
Store a value with optional metadata.

```typescript
await storage.setItem('user-settings', 
  { notifications: true },
  { ttl: 3600000 } // 1 hour TTL
);
```

#### `getItem(key: string): any`
Retrieve a value by key.

```typescript
const settings = storage.getItem('user-settings');
```

#### `removeItem(key: string): Promise<void>`
Remove an item from storage.

```typescript
await storage.removeItem('user-settings');
```

#### `getAllItems(): Promise<StorageItem[]>`
Get all items from storage.

```typescript
const allItems = await storage.getAllItems();
```

#### `hasItem(key: string): Promise<boolean>`
Check if an item exists.

```typescript
const exists = await storage.hasItem('user-settings');
```

#### `executeBatch(operations: BatchOperation[]): Promise<BatchResult>`
Execute multiple operations in a single batch.

```typescript
const result = await storage.executeBatch([
  { type: 'set', key: 'item1', value: 'value1' },
  { type: 'set', key: 'item2', value: 'value2' },
  { type: 'remove', key: 'item3' }
]);
```

### Real-time Subscriptions

#### `subscribe(keys: string[]): Promise<void>`
Subscribe to real-time updates for specific keys.

```typescript
await storage.subscribe(['user-settings', 'user-profile']);
```

#### `unsubscribe(keys: string[]): Promise<void>`
Unsubscribe from updates.

```typescript
await storage.unsubscribe(['user-settings']);
```

### Event Handling

The sync client emits various events that you can listen to:

```typescript
// Data change events
storage.on('change', (event) => {
  console.log('Key:', event.key);
  console.log('Old Value:', event.oldValue);
  console.log('New Value:', event.newValue);
  console.log('Source:', event.source); // 'local' or 'remote'
});

// Sync events
storage.on('sync', (event) => {
  console.log('Sync event:', event);
});

// Connection events
storage.on('connect', () => {
  console.log('Connected to server');
});

storage.on('disconnect', () => {
  console.log('Disconnected from server');
});

// Error events
storage.on('error', (error) => {
  console.error('Error:', error);
});

// Conflict events
storage.on('conflict', (conflict) => {
  console.log('Conflict detected:', conflict);
});
```

## Configuration Options

```typescript
interface RemoteStorageConfig {
  // Required
  serverUrl: string;        // Server URL
  userId: string;           // User identifier
  
  // Transport Configuration
  mode?: TransportMode;     // Transport mode (default: AUTO)
  apiKey?: string;          // API key for authentication
  timeout?: number;         // Request timeout in ms (default: 5000)
  reconnection?: boolean;   // Enable auto-reconnection (default: true)
  
  // Retry Configuration
  retry?: {
    maxAttempts: number;    // Max retry attempts (default: 3)
    backoffStrategy: 'linear' | 'exponential'; // (default: 'exponential')
    baseDelay: number;      // Base delay in ms (default: 1000)
    maxDelay: number;       // Max delay in ms (default: 30000)
    jitter?: boolean;       // Add jitter to delays (default: true)
  };
  
  // Conflict Resolution
  conflict?: {
    strategy: ConflictStrategy;  // Resolution strategy
    autoResolve: boolean;         // Auto-resolve conflicts (default: true)
    onConflict?: (conflict: ConflictData) => Promise<any>;
  };
  
  // Performance & Analytics
  analytics?: {
    enabled: boolean;             // Enable analytics (default: false)
    trackPerformance?: boolean;   // Track performance metrics
    trackErrors?: boolean;        // Track errors
    endpoint?: string;            // Analytics endpoint
  };
  
  // Storage Configuration
  storage?: {
    maxSize: number;              // Max storage size in bytes
    compressionEnabled: boolean;  // Enable compression
    encryptionKey?: string;       // Encryption key
    ttl?: number;                 // Default TTL in ms
  };
  
  // Debug Configuration
  debug?: {
    logLevel: 'none' | 'error' | 'warn' | 'info' | 'debug';
    performanceMonitoring: boolean;
    networkLogging: boolean;
  };
}
```

## React Integration

Use the provided React hooks for seamless integration:

```tsx
import { useRemoteStorage, useStorageItem } from '@usex/sync-client';

function UserSettings() {
  const storage = useRemoteStorage({
    serverUrl: 'https://api.example.com',
    userId: 'user123'
  });
  
  const [settings, setSettings, { loading, error }] = useStorageItem(
    storage,
    'user-settings',
    { notifications: true } // default value
  );
  
  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;
  
  return (
    <div>
      <label>
        <input
          type="checkbox"
          checked={settings.notifications}
          onChange={(e) => setSettings({
            ...settings,
            notifications: e.target.checked
          })}
        />
        Enable Notifications
      </label>
    </div>
  );
}
```

## Performance Monitoring

The sync client includes built-in performance monitoring:

```typescript
import { configureLogger, LogLevel } from '@usex/sync-client';

// Configure logging
configureLogger({
  level: LogLevel.DEBUG,
  useColors: true,
  enableMetrics: true
});

// Access performance metrics
const metrics = storage.getAnalytics();
console.log('Average sync latency:', metrics.syncLatency);
console.log('Cache hit rate:', metrics.cacheHitRate);

// Listen for performance warnings
storage.on('performance-warning', (warning) => {
  console.warn(`Performance issue: ${warning.metric}`, warning);
});
```

## Advanced Usage

### Custom Conflict Resolution

```typescript
const storage = createRemoteStorage({
  serverUrl: 'https://api.example.com',
  userId: 'user123',
  conflict: {
    strategy: ConflictStrategy.MANUAL,
    autoResolve: false,
    onConflict: async (conflict) => {
      // Custom conflict resolution logic
      console.log('Resolving conflict:', conflict);
      
      // Example: Always prefer remote value
      return conflict.remoteValue;
      
      // Or: Merge values
      // return { ...conflict.localValue, ...conflict.remoteValue };
    }
  }
});
```

### Filtering Sync Operations

```typescript
// Only sync specific keys
storage.setSyncFilter({
  includePatterns: ['^user-', '^settings-'],
  excludePatterns: ['^temp-'],
  maxItemSize: 1024 * 1024, // 1MB max per item
  syncOnlyRecent: true
});
```

### TTL Management

```typescript
// Set item with TTL
await storage.setItem('session-data', data, { ttl: 3600000 }); // 1 hour

// Check remaining TTL
const ttl = await storage.getTTL('session-data');
console.log(`Expires in ${ttl}ms`);

// Extend TTL
await storage.extendTTL('session-data', 1800000); // Add 30 minutes
```

### Performance Optimization

```typescript
// Check storage capacity
const nearCapacity = await storage.isNearCapacity(80); // 80% threshold
if (nearCapacity) {
  console.warn('Storage is near capacity');
}

// Export data for backup
const exportedData = await storage.export();
localStorage.setItem('backup', JSON.stringify(exportedData));
```

## Error Handling

```typescript
try {
  await storage.connect();
} catch (error) {
  if (error.code === 'AUTH_FAILED') {
    // Handle authentication error
  } else if (error.code === 'NETWORK_ERROR') {
    // Handle network error
  } else {
    // Handle other errors
  }
}

// Listen for errors
storage.on('error', (error) => {
  switch (error.type) {
    case 'connection':
      console.error('Connection error:', error.message);
      break;
    case 'sync':
      console.error('Sync error:', error.message);
      break;
    case 'quota':
      console.error('Storage quota exceeded');
      break;
  }
});
```

## FAQ

### Q: What happens when the connection is lost?

A: The sync client automatically queues operations when offline and syncs them when the connection is restored. In AUTO mode, it will automatically fallback from WebSocket to HTTP if needed.

### Q: How are conflicts handled?

A: The client supports multiple conflict resolution strategies:
- **Last Write Wins**: The most recent change wins (default)
- **First Write Wins**: The first change wins
- **Merge**: Attempts to merge changes
- **Manual**: Call your custom resolution function

### Q: Is the data encrypted?

A: You can enable encryption by providing an encryption key in the configuration:
```typescript
storage: {
  encryptionKey: 'your-encryption-key'
}
```

### Q: How much data can be stored?

A: The storage limit is configurable:
```typescript
storage: {
  maxSize: 10 * 1024 * 1024 // 10MB
}
```

### Q: Can I use this in a React Native app?

A: Yes, the sync client works in React Native environments. Make sure to install the required dependencies for WebSocket support.

### Q: How do I debug connection issues?

A: Enable debug logging:
```typescript
debug: {
  logLevel: 'debug',
  networkLogging: true
}
```

### Q: Which transport mode should I use?

A: **AUTO mode is recommended** for most use cases as it provides the best of both worlds:
- Prefers WebSocket for real-time capabilities
- Falls back to HTTP if WebSocket fails
- Automatically attempts to return to WebSocket when available

Use **HTTP mode** only when:
- WebSocket is blocked by firewalls/proxies
- You only need request-response patterns
- Server doesn't support WebSocket

Use **WebSocket mode** only when:
- You're certain WebSocket is always available
- You need guaranteed real-time communication
- You want to avoid HTTP fallback overhead

### Q: How does the automatic fallback work?

A: In AUTO mode, the client:
1. Attempts to connect via WebSocket first
2. If WebSocket fails, automatically falls back to HTTP
3. Continues to periodically retry WebSocket in the background
4. Seamlessly switches back to WebSocket when available
5. Maintains all functionality regardless of active transport

### Q: What's the performance difference between transports?

A: **WebSocket**:
- Lower latency for real-time updates
- Persistent connection reduces overhead
- Better for frequent bidirectional communication

**HTTP**:
- Higher latency but more reliable in restricted networks
- Stateless requests work better with load balancers
- Better for simple request-response patterns

### Q: Can I customize retry behavior?

A: Yes, configure retry settings for your use case:
```typescript
const storage = createRemoteStorage({
  retry: {
    maxAttempts: 5,
    backoffStrategy: 'exponential',
    baseDelay: 2000,
    maxDelay: 30000,
    jitter: true
  }
});
```

### Q: How do I monitor transport performance?

A: Use the built-in performance monitoring:
```typescript
// Get transport metrics
const metrics = storage.getTransportMetrics();
console.log('Current transport:', metrics.activeTransport);
console.log('Average latency:', metrics.averageLatency);
console.log('Success rate:', metrics.successRate);

// Listen for transport switches
storage.on('transport-switch', (event) => {
  console.log(`Switched from ${event.from} to ${event.to}`);
});
```

## Contributing

We welcome contributions! Please see our [Contributing Guide](../../CONTRIBUTING.md) for details.

## License

Apache-2.0 © Ali Torki

## Support

For issues and feature requests, please [create an issue](https://github.com/ali-master/sync-store/issues) on GitHub.
