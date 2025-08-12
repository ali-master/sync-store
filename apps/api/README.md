# 🚀 Sync Store API

> Real-time synchronization backend with CQRS architecture, advanced conflict resolution, and comprehensive analytics

## 📋 Overview

The Sync Store API is a production-ready NestJS backend service that powers real-time data synchronization across distributed applications. Built with CQRS pattern, it provides WebSocket-based real-time sync, REST APIs, advanced conflict resolution, and comprehensive analytics with monitoring capabilities.

## ✨ Core Features

### Real-time Synchronization
- **WebSocket Gateway** - Bidirectional real-time communication via Socket.io
- **Event-driven Updates** - Instant propagation across all connected clients
- **Offline Queue** - Pending updates stored for disconnected clients
- **Session Management** - Track device connections and activity

### Architecture & Patterns
- **CQRS Implementation** - Separate command/query handlers with event sourcing
- **Repository Pattern** - Clean data access layer abstraction
- **Modular Domain Design** - Organized by business capabilities
- **Event-driven Architecture** - Loosely coupled components via events

### Security & Authentication
- **API Key System** - Advanced key management with comprehensive restrictions
- **JWT Authentication** - Secure user sessions with refresh tokens
- **Rate Limiting** - Configurable throttling per API key/user
- **IP/Country Restrictions** - Geo-based access control
- **Domain Whitelisting** - CORS and origin validation

### Conflict Resolution Engine
- **Multiple Strategies** - Last-write-wins, first-write-wins, merge, AI-assisted
- **Automatic Detection** - Version mismatch and concurrent modification detection
- **Conflict Analytics** - Track patterns and resolution success rates
- **Manual Review Queue** - Human intervention for complex conflicts

### Analytics & Monitoring
- **Real-time Metrics** - Live dashboard with key performance indicators
- **User Analytics** - Engagement, behavior patterns, cohort analysis
- **API Key Analytics** - Usage tracking, security insights, performance trends
- **Instance Analytics** - Health monitoring, resource utilization, reliability metrics
- **Comprehensive Audit Trail** - Complete activity logging

## 🏗️ Project Structure

```
apps/api/
├── src/
│   ├── domains/                     # Business domains
│   │   ├── sync-storage/           # Core sync functionality
│   │   │   ├── commands/           # CQRS commands
│   │   │   ├── queries/            # CQRS queries
│   │   │   ├── events/             # Domain events
│   │   │   ├── gateways/           # WebSocket gateway
│   │   │   ├── controllers/        # REST controllers
│   │   │   ├── services/           # Business logic
│   │   │   ├── repositories/       # Data access
│   │   │   ├── guards/             # Auth guards
│   │   │   └── dto/                # Data transfer objects
│   │   └── analytics/              # Analytics module
│   │       ├── controllers/        # Analytics endpoints
│   │       ├── services/           # Aggregation services
│   │       └── middleware/         # Tracking middleware
│   ├── modules/                    # Shared modules
│   │   ├── context/               # Request context management
│   │   └── db/                    # Database client & decorators
│   ├── guards/                     # Global guards
│   ├── interceptors/              # Global interceptors
│   ├── filters/                   # Exception filters
│   └── main.ts                    # Application bootstrap
├── prisma/
│   ├── schema/                    # Database schemas
│   │   ├── sync-storage.prisma   # Storage models
│   │   ├── api-key.prisma        # API key models
│   │   └── schema.prisma         # Main schema
│   └── seed/                      # Seed data scripts
└── test/                          # E2E tests
```

## 📡 API Reference

### WebSocket Events (Namespace: `/sync`)

#### Connection
Connect with query parameters:
```javascript
const socket = io('ws://localhost:3000/sync', {
  query: {
    userId: 'user123',
    instanceId: 'browser-001'
  }
});
```

#### Client → Server Events

| Event | Description | Payload |
|-------|-------------|---------|
| `sync:set` | Store/update item | `{ key, value, metadata?, version?, timestamp? }` |
| `sync:remove` | Remove item | `{ key }` |
| `sync:get` | Get single item | `{ key }` |
| `sync:getAll` | Get all items | `{ prefix? }` |
| `sync:subscribe` | Subscribe to keys | `{ keys: string[] }` |
| `sync:unsubscribe` | Unsubscribe from keys | `{ keys: string[] }` |

#### Server → Client Events

| Event | Description | Payload |
|-------|-------------|---------|
| `sync:update` | Item updated | `{ key, value, metadata, version, timestamp }` |
| `sync:remove` | Item removed | `{ key, timestamp }` |
| `pending-updates` | Queued updates on connect | `Array<SyncEvent>` |
| `error` | Error occurred | `{ message, code, details }` |

### REST API Endpoints

Base URL: `/api/v1`

#### Storage Operations

```http
# Get item
GET /sync-storage/item/{key}
X-API-Key: your-api-key

# Set/update item
PUT /sync-storage/item/{key}
X-API-Key: your-api-key
Content-Type: application/json
{
  "value": any,
  "metadata": {},
  "version": 1
}

# Remove item
DELETE /sync-storage/item/{key}
X-API-Key: your-api-key

# Get all items
GET /sync-storage/items?prefix=user_
X-API-Key: your-api-key

# Get all keys
GET /sync-storage/keys?prefix=settings_
X-API-Key: your-api-key

# Clear all data
DELETE /sync-storage/clear
X-API-Key: your-api-key
```

#### Conflict Resolution

```http
# Get conflict history
GET /sync-storage/conflicts/history/{itemId}

# Get conflict statistics
GET /sync-storage/conflicts/stats

# Resolve conflict
PUT /sync-storage/conflicts/resolve/{conflictId}
{
  "strategy": "MERGE",
  "resolvedValue": {}
}

# Analyze conflicts
POST /sync-storage/conflicts/analyze
{
  "itemIds": ["id1", "id2"]
}
```

#### Analytics Endpoints

```http
# Dashboard overview
GET /analytics/dashboard

# Real-time metrics
GET /analytics/realtime

# User analytics
GET /analytics/users/{userId}
GET /analytics/users/{userId}/engagement
GET /analytics/users/{userId}/behavior

# API key analytics
GET /analytics/api-keys/{keyId}
GET /analytics/api-keys/{keyId}/security
GET /analytics/api-keys/{keyId}/trends

# Instance analytics
GET /analytics/instances/{instanceId}
GET /analytics/instances/{instanceId}/performance
GET /analytics/instances/{instanceId}/health
```

## 🗄️ Database Schema

### Core Models

#### SyncStorageItem
```prisma
model SyncStorageItem {
  id              String    @id @default(cuid())
  userId          String
  instanceId      String
  key             String
  value           String    // JSON serialized
  metadata        String?   // JSON serialized
  version         Int       @default(1)
  timestamp       BigInt
  lastModified    DateTime  @updatedAt
  isDeleted       Boolean   @default(false)
  size            Int       // bytes
  compressionType String?
  encryptionType  String?
  tags            String?   // JSON array
  ttl             DateTime?
  priority        Int       @default(0)
  
  @@unique([userId, key])
  @@index([userId, instanceId])
  @@index([timestamp])
}
```

#### ApiKey
```prisma
model ApiKey {
  id                  String    @id @default(cuid())
  name                String
  key                 String    @unique
  isActive            Boolean   @default(true)
  expiresAt           DateTime?
  
  // Permissions
  canRead             Boolean   @default(true)
  canWrite            Boolean   @default(true)
  scopes              String?   // JSON array
  
  // Restrictions
  ipRestrictions      String?   // JSON array
  countryRestrictions String?   // JSON array
  domainRestrictions  String?   // JSON array
  userAgentPatterns   String?   // JSON array
  
  // Quotas
  quotaPerMinute      Int?
  quotaPerHour        Int?
  quotaPerDay         Int?
  quotaPerMonth       Int?
  
  // Usage tracking
  usageToday          Int       @default(0)
  usageThisMonth      Int       @default(0)
  lastUsedAt          DateTime?
  
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
}
```

## 🔧 Configuration

### Environment Variables

```env
# Server
NODE_ENV=production
PORT=3000
API_URL=https://api.yourdomain.com

# Database (MariaDB)
DATABASE_URL="mysql://user:password@localhost:3306/syncstore"
DB_CONNECTION_LIMIT=10
DB_SSL=true

# Redis (Optional - for caching)
REDIS_URL="redis://localhost:6379"
REDIS_DB=0

# Authentication
JWT_SECRET=your-secret-key-min-32-chars
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=your-refresh-secret
JWT_REFRESH_EXPIRES_IN=30d

# API Keys
API_KEYS_ENABLED=true
API_KEY_TOKEN_PREFIX=sk_live_
API_KEY_DEFAULT_SCOPES=["read", "write"]
API_KEY_EXPIRATION_DAYS=365

# Security
BCRYPT_SALT_ROUNDS=12
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
CSRF_SECRET=your-csrf-secret

# CORS
CORS_ORIGIN=https://app.yourdomain.com
CORS_CREDENTIALS=true

# Monitoring
LOG_LEVEL=info
LOG_FORMAT=json
ENABLE_ANALYTICS=true
ANALYTICS_BATCH_SIZE=100

# Storage Limits
MAX_ITEM_SIZE_KB=100
MAX_STORAGE_PER_USER_MB=100
TTL_CLEANUP_INTERVAL_HOURS=24
```

## 🚀 Getting Started

### Prerequisites
- Node.js >= 23.11.0
- pnpm >= 10.14.0
- MariaDB >= 10.6 or MySQL >= 8.0
- Redis >= 6.0 (optional, for caching)

### Installation

1. **Install dependencies**
```bash
cd apps/api
pnpm install
```

2. **Configure environment**
```bash
cp .env.example .env.local
# Edit .env.local with your configuration
```

3. **Setup database**
```bash
# Generate Prisma client
pnpm db:generate

# Run migrations
pnpm db:migrate

# Seed initial data (optional)
pnpm db:seed
```

4. **Start server**
```bash
# Development
pnpm dev

# Production
pnpm build
pnpm start:prod
```

## 🧪 Testing

```bash
# Unit tests
pnpm test

# E2E tests
pnpm test:e2e

# Test coverage
pnpm test:cov

# Watch mode
pnpm test:watch
```

## 📦 Building & Deployment

### Local Build
```bash
# Build for production
NODE_ENV=production pnpm build

# Run production build
node dist/main.js
```

### Docker Deployment
```bash
# Build image
docker build -t sync-store-api .

# Run container
docker run -d \
  --name sync-store-api \
  -p 3000:3000 \
  --env-file .env.production \
  sync-store-api
```

### PM2 Deployment
```bash
# Install PM2
npm install -g pm2

# Start with PM2
pm2 start dist/main.js --name sync-store-api

# Save PM2 configuration
pm2 save
pm2 startup
```

## 🔒 Security Best Practices

1. **API Key Management**
   - Use strong, randomly generated API keys
   - Implement key rotation policies
   - Set appropriate quotas and rate limits
   - Enable IP/domain restrictions for production

2. **Database Security**
   - Use SSL/TLS connections
   - Implement connection pooling
   - Regular backups and disaster recovery
   - Use read replicas for analytics

3. **Environment Security**
   - Never commit `.env` files
   - Use secrets management (Vault, AWS Secrets Manager)
   - Implement proper CORS policies
   - Enable HTTPS in production

## 📊 Monitoring & Observability

- **Health Check**: `GET /health`
- **Metrics**: `GET /metrics` (Prometheus format)
- **OpenTelemetry**: Built-in tracing support
- **Structured Logging**: JSON format with correlation IDs

## 🛠️ Development

### Available Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development server with hot reload |
| `pnpm build` | Build for production |
| `pnpm start:prod` | Run production build |
| `pnpm lint` | Run ESLint |
| `pnpm format` | Format code with Prettier |
| `pnpm test` | Run unit tests |
| `pnpm test:e2e` | Run E2E tests |
| `pnpm db:generate` | Generate Prisma client |
| `pnpm db:migrate` | Run database migrations |
| `pnpm db:seed` | Seed database with sample data |
| `pnpm db:view` | Open Prisma Studio |

## 📝 License

Apache License 2.0 - see [LICENSE](../../LICENSE) for details

## 📞 Support

- **Documentation**: [Self-Hosting Guide](./SELF_HOSTED.md)
- **Issues**: [GitHub Issues](https://github.com/yourusername/sync-store/issues)
- **Email**: ali_4286@live.com

---

Built with ❤️ using [NestJS](https://nestjs.com), [Prisma](https://prisma.io), and [Socket.io](https://socket.io)
