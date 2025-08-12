export const envConfigLoader = () => ({
  port: parseInt(process.env.PORT || "3000", 10),
  env: {
    name: process.env.NODE_ENV || "development",
    isProduction: process.env.NODE_ENV === "production",
    isDevelopment: process.env.NODE_ENV === "development",
    isTest: process.env.NODE_ENV === "test",
  },
  database: {
    url: process.env.DATABASE_URL,
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "3306", 10),
    username: process.env.DB_USERNAME || "root",
    password: process.env.DB_PASSWORD || "pass@1234",
    database: process.env.DB_DATABASE || "payment_gateway",
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || "10", 10),
    ssl: process.env.DB_SSL === "true",
    timezone: process.env.DB_TIMEZONE || "Asia/Tehran",
  },
  redis: {
    url: process.env.REDIS_URL,
    db: parseInt(process.env.REDIS_DB || "0", 10),
    password: process.env.REDIS_PASSWORD || null,
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379", 10),
  },
  apiUrl: process.env.API_URL || "http://localhost:3000",
  apiKeys: {
    enabled: process.env.API_KEYS_ENABLED === "true",
    prefix: process.env.API_KEY_TOKEN_PREFIX || "usex_", // Default prefix for API keys
    defaultScopes: process.env.API_KEY_DEFAULT_SCOPES
      ? process.env.API_KEY_DEFAULT_SCOPES.split(",").map((scope) => scope.trim())
      : ["read", "write"], // Default scopes if not set
    defaultEnvironment: process.env.API_KEY_DEFAULT_ENVIRONMENT || "development",
    expirationDays: parseInt(process.env.API_KEY_EXPIRATION_DAYS || "365", 10),
  },
  logging: {
    level: process.env.LOG_LEVEL || "info",
    format: process.env.LOG_FORMAT || "json",
    silent: process.env.LOG_SILENT === "true",
    colorize: process.env.LOG_COLORIZE as "message" | "level" | "all" | undefined,
  },
  security: {
    bcryptSaltRounds: 12,
    rateLimiting: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
    },
    csrfSecret: process.env.CSRF_SECRET,
  },
});
