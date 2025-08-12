import task from "tasuku";
import { SystemLogger } from "@usex/utils";
import { PrismaClient } from "@prisma/client";

export async function PrepareMain(db: PrismaClient) {
  const logger = SystemLogger("db:prepare");

  await task("Preparing main", async ({ setTitle, setError }) => {
    try {
      setTitle("Seeding database with sync store data...");

      // Hardcoded CUID v2 IDs for consistent seeding
      const IDS = {
        // API Key IDs
        API_KEY_DEV: "cln4xkz9u0000mt5xhzqzqvqz",
        API_KEY_PROD: "cln4xl4rt0001mt5xgxjkqm8w",
        API_KEY_ADMIN: "cln4xl9lv0002mt5x4mnjxk2r",

        // User and Instance IDs
        DEMO_USER: "cln4xldfq0003mt5x9vwxmfnr",
        DEMO_INSTANCE: "cln4xlifj0004mt5xkvnxlp8m",

        // Storage Item IDs
        SYNC_ITEM_PREFERENCES: "cln4xlmxz0005mt5x7hzqrtvw",
        SYNC_ITEM_CONFIG: "cln4xlqhr0006mt5x3vjwxm2p",
        SYNC_ITEM_SESSION: "cln4xltw80007mt5xnjrxkv9q",

        // Quota ID
        QUOTA_DEMO: "cln4xlx4j0008mt5x8mwxtrfv",

        // Session ID
        SESSION_DEMO: "cln4xm0rk0009mt5xlpjxvw4m",

        // Analytics ID
        ANALYTICS_DEMO: "cln4xm4dl000amt5xhjzqrm8v",
      };

      // 1. Create default API keys with comprehensive restrictions
      await task("Creating default API keys", async ({ setTitle }) => {
        setTitle("Creating development API key...");

        await db.apiKey.upsert({
          where: { id: IDS.API_KEY_DEV },
          create: {
            id: IDS.API_KEY_DEV,
            name: "Development API Key",
            key: "usex_dev_cln4xkz9u0000mt5xhzqzqvqz12345678",
            description: "Default development API key with basic restrictions",
            isActive: true,
            expiresAt: null, // Never expires

            // Basic permissions
            canRead: true,
            canWrite: true,
            scopes: JSON.stringify(["sync:read", "sync:write", "sync:delete"]),

            // IP and domain restrictions
            ipRestrictions: JSON.stringify(["127.0.0.1", "localhost", "192.168.*"]),
            restrictionMode: "allow",
            websiteOrigins: JSON.stringify([
              "localhost",
              "*.localhost",
              "127.0.0.1",
              "*.dev",
              "*.test",
            ]),

            // Quota limits
            minuteQuota: 1000,
            hourQuota: 50000,
            dailyQuota: 1000000,
            monthlyQuota: 30000000,

            // Origin restrictions (for development)
            originRestrictions: JSON.stringify([]),

            // Security settings
            requireHttps: false,
            allowedMethods: JSON.stringify(["GET", "POST", "PUT", "DELETE"]),
            allowedUserAgents: JSON.stringify([]),
            blockedUserAgents: JSON.stringify([]),

            // Analytics
            enableAnalytics: true,
            alertThresholds: JSON.stringify({
              errorRate: 0.05,
              responseTime: 5000,
              quotaUsage: 0.9,
            }),

            // Metadata
            metadata: JSON.stringify({
              environment: "development",
              created_by: "system_seed",
              purpose: "Default development key for testing",
            }),
          },
          update: {
            name: "Development API Key",
            description: "Default development API key with basic restrictions",
            isActive: true,
          },
        });

        setTitle("Creating production-ready API key...");

        await db.apiKey.upsert({
          where: { id: IDS.API_KEY_PROD },
          create: {
            id: IDS.API_KEY_PROD,
            name: "Production Demo Key",
            key: "usex_prod_cln4xl4rt0001mt5xgxjkqm8w87654321",
            description: "Production-ready API key with strict restrictions",
            isActive: true,
            expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year from now

            // Basic permissions
            canRead: true,
            canWrite: true,
            scopes: JSON.stringify(["sync:read", "sync:write"]),

            // Strict IP and domain restrictions
            restrictionMode: "allow",
            websiteOrigins: JSON.stringify(["*.example.com", "app.mycompany.com"]),

            // Conservative quota limits
            minuteQuota: 100,
            hourQuota: 5000,
            dailyQuota: 100000,
            monthlyQuota: 3000000,

            // Origin restrictions for production
            originRestrictions: JSON.stringify([]),

            // Security settings
            requireHttps: true,
            allowedMethods: JSON.stringify(["GET", "POST", "PUT"]),
            allowedUserAgents: JSON.stringify(["MyApp/*", "Mozilla/*"]),
            blockedUserAgents: JSON.stringify(["*bot*", "*crawler*", "*spider*"]),

            // Analytics
            enableAnalytics: true,
            alertThresholds: JSON.stringify({
              errorRate: 0.01,
              responseTime: 2000,
              quotaUsage: 0.8,
            }),

            // Metadata
            metadata: JSON.stringify({
              environment: "production",
              created_by: "system_seed",
              purpose: "Production demo key with strict security",
            }),
          },
          update: {
            name: "Production Demo Key",
            description: "Production-ready API key with strict restrictions",
            isActive: true,
          },
        });

        setTitle("Creating admin API key...");

        await db.apiKey.upsert({
          where: { id: IDS.API_KEY_ADMIN },
          create: {
            id: IDS.API_KEY_ADMIN,
            name: "Admin Super Key",
            key: "usex_admin_cln4xl9lv0002mt5x4mnjxk2r99999999",
            description: "Administrative API key with unrestricted access",
            isActive: true,
            expiresAt: null, // Never expires

            // Full permissions
            canRead: true,
            canWrite: true,
            scopes: JSON.stringify(["*"]),

            // No restrictions
            restrictionMode: "allow",
            websiteOrigins: JSON.stringify([]),
            ipRestrictions: JSON.stringify([]),

            // High quota limits
            minuteQuota: 10000,
            hourQuota: 500000,
            dailyQuota: 10000000,
            monthlyQuota: null, // Unlimited

            // No origin restrictions
            originRestrictions: JSON.stringify([]),

            // Flexible security
            requireHttps: false,
            allowedMethods: JSON.stringify(["GET", "POST", "PUT", "DELETE", "PATCH"]),
            allowedUserAgents: JSON.stringify([]),
            blockedUserAgents: JSON.stringify([]),

            // Analytics enabled
            enableAnalytics: true,
            alertThresholds: JSON.stringify({
              errorRate: 0.1,
              responseTime: 10000,
              quotaUsage: 0.95,
            }),

            // Metadata
            metadata: JSON.stringify({
              environment: "admin",
              created_by: "system_seed",
              purpose: "Administrative access with full permissions",
              warning: "Use with extreme caution",
            }),
          },
          update: {
            name: "Admin Super Key",
            description: "Administrative API key with unrestricted access",
            isActive: true,
          },
        });
      });

      // 2. Create sample sync storage items for demo purposes
      await task("Creating sample sync storage data", async ({ setTitle }) => {
        setTitle("Creating demo user storage items...");

        const sampleItems = [
          {
            id: IDS.SYNC_ITEM_PREFERENCES,
            userId: IDS.DEMO_USER,
            instanceId: IDS.DEMO_INSTANCE,
            key: "user:preferences",
            value: JSON.stringify({
              theme: "dark",
              language: "en",
              notifications: true,
              autoSave: true,
              displayDensity: "comfortable",
            }),
            metadata: JSON.stringify({
              category: "user_settings",
              lastModifiedBy: "user_interface",
              version: "1.0",
            }),
            version: 1,
            timestamp: BigInt(Date.now()),
            size: 0,
            priority: 1,
          },
          {
            id: IDS.SYNC_ITEM_CONFIG,
            userId: IDS.DEMO_USER,
            instanceId: IDS.DEMO_INSTANCE,
            key: "app:config",
            value: JSON.stringify({
              apiEndpoint: "https://api.example.com",
              timeout: 30000,
              retryCount: 3,
              enableLogging: true,
              logLevel: "info",
            }),
            metadata: JSON.stringify({
              category: "application_config",
              environment: "production",
              lastUpdated: new Date().toISOString(),
            }),
            version: 2,
            timestamp: BigInt(Date.now()),
            size: 0,
            priority: 2,
          },
          {
            id: IDS.SYNC_ITEM_SESSION,
            userId: IDS.DEMO_USER,
            instanceId: IDS.DEMO_INSTANCE,
            key: "session:current",
            value: JSON.stringify({
              sessionId: IDS.SESSION_DEMO,
              startTime: Date.now(),
              lastActivity: Date.now(),
              features: ["sync", "offline", "encryption"],
              deviceInfo: {
                platform: "web",
                browser: "chrome",
                version: "120.0",
              },
            }),
            metadata: JSON.stringify({
              category: "session_management",
              temporary: true,
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            }),
            version: 1,
            timestamp: BigInt(Date.now()),
            size: 0,
            priority: 3,
            ttl: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
          },
        ];

        for (const item of sampleItems) {
          item.size = Buffer.byteLength(item.value, "utf8");

          await db.syncStorageItem.upsert({
            where: { id: item.id },
            create: item,
            update: {
              value: item.value,
              metadata: item.metadata,
              version: item.version,
              timestamp: item.timestamp,
              size: item.size,
            },
          });
        }
      });

      // 3. Create sample user quotas
      await task("Setting up user quotas", async ({ setTitle }) => {
        setTitle("Creating default quota settings...");

        await db.syncQuota.upsert({
          where: { id: IDS.QUOTA_DEMO },
          create: {
            id: IDS.QUOTA_DEMO,
            userId: IDS.DEMO_USER,

            // Storage quotas
            maxStorageBytes: BigInt(104857600), // 100MB
            currentStorageBytes: BigInt(2048), // 2KB used
            maxItems: 10000,
            currentItems: 3,

            // Rate limiting
            requestsPerMinute: 1000,
            requestsPerHour: 50000,
            requestsPerDay: 1000000,

            // Advanced quotas
            maxInstancesPerUser: 10,
            maxConflictsPerHour: 100,
            maxAuditRetentionDays: 90,

            // Current usage (reset by cron jobs)
            currentMinuteRequests: 0,
            currentHourRequests: 0,
            currentDailyRequests: 0,

            // Feature flags
            aiResolutionEnabled: true,
            encryptionEnabled: false,
            compressionEnabled: true,
            priorityQueueEnabled: true,
          },
          update: {
            maxStorageBytes: BigInt(104857600),
            currentStorageBytes: BigInt(2048),
            currentItems: 3,
          },
        });
      });

      // 4. Create sample sync session
      await task("Creating sample sync sessions", async ({ setTitle }) => {
        setTitle("Setting up demo sync sessions...");

        await db.syncSession.upsert({
          where: { id: IDS.SESSION_DEMO },
          create: {
            id: IDS.SESSION_DEMO,
            userId: IDS.DEMO_USER,
            instanceId: IDS.DEMO_INSTANCE,
            socketId: "socket_" + IDS.SESSION_DEMO,
            connectionType: "websocket",
            connectedAt: new Date(),
            lastActivity: new Date(),

            // Connection metadata
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            ipAddress: "127.0.0.1",
            country: "US",
            city: "San Francisco",
            device: JSON.stringify({
              type: "desktop",
              os: "macOS",
              browser: "Chrome",
              version: "120.0",
            }),

            // Feature flags
            features: JSON.stringify(["realtime_sync", "offline_queue", "conflict_resolution"]),

            // Performance metrics
            latencyMs: 25,
            packetsReceived: 156,
            packetsSent: 134,
          },
          update: {
            lastActivity: new Date(),
            packetsReceived: 156,
            packetsSent: 134,
          },
        });
      });

      // 5. Create sample analytics data
      await task("Initializing analytics data", async ({ setTitle }) => {
        setTitle("Setting up analytics and metrics...");

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        await db.syncAnalytics.upsert({
          where: {
            userId_date: {
              userId: IDS.DEMO_USER,
              date: today,
            },
          },
          create: {
            id: IDS.ANALYTICS_DEMO,
            userId: IDS.DEMO_USER,
            date: today,

            // Usage metrics
            totalOperations: 45,
            readOperations: 30,
            writeOperations: 12,
            deleteOperations: 2,
            syncOperations: 1,

            // Performance metrics
            avgResponseTimeMs: 125.5,
            p50ResponseTimeMs: 95,
            p90ResponseTimeMs: 200,
            p99ResponseTimeMs: 450,

            // Storage metrics
            storageUsedBytes: BigInt(2048),
            itemCount: 3,
            avgItemSizeBytes: 682,

            // Conflict metrics
            conflictsGenerated: 1,
            conflictsResolved: 1,
            autoResolutionRate: 1.0,

            // Session metrics
            activeSessions: 1,
            peakConcurrentSessions: 2,
            avgSessionDurationMs: BigInt(3600000), // 1 hour

            // Error metrics
            errorRate: 0.02,
            timeoutRate: 0.001,

            // Advanced insights
            dataHotspots: JSON.stringify([
              { key: "user:preferences", accessCount: 15 },
              { key: "app:config", accessCount: 8 },
              { key: "session:current", accessCount: 22 },
            ]),
            userBehaviorPatterns: JSON.stringify({
              peakHours: [9, 10, 14, 15, 16],
              preferredOperations: ["read", "sync"],
              avgSessionLength: "1h 15m",
              deviceTypes: ["desktop", "mobile"],
            }),
            performanceBottlenecks: JSON.stringify({
              slowQueries: [],
              highLatencyOperations: ["conflict_resolution"],
              resourceUsage: {
                cpu: "low",
                memory: "moderate",
                network: "low",
              },
            }),
          },
          update: {
            totalOperations: 45,
            avgResponseTimeMs: 125.5,
            activeSessions: 1,
          },
        });
      });

      // 6. Log seeding completion with actual IDs
      logger.log("✅ Database seeded successfully with CUID v2 IDs:");
      logger.log(
        `   • 3 API keys (dev: ${IDS.API_KEY_DEV.slice(-8)}, prod: ${IDS.API_KEY_PROD.slice(-8)}, admin: ${IDS.API_KEY_ADMIN.slice(-8)})`,
      );
      logger.log(`   • 3 sample sync storage items for user: ${IDS.DEMO_USER.slice(-8)}`);
      logger.log(`   • 1 user quota configuration: ${IDS.QUOTA_DEMO.slice(-8)}`);
      logger.log(`   • 1 active sync session: ${IDS.SESSION_DEMO.slice(-8)}`);
      logger.log(`   • 1 analytics record: ${IDS.ANALYTICS_DEMO.slice(-8)}`);
      logger.log("   • All IDs are hardcoded CUID v2 for consistent testing");

      setTitle("🎉 Database comprehensively seeded with CUID v2 sync store data!");
    } catch (error) {
      logger.error("Failed to seed database:", error);
      setError(error as Error);
      throw error;
    }
  });
}
