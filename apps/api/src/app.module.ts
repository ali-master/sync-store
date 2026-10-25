import { Module } from "@nestjs/common";
// Global Modules
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { ContextModule, DatabaseModule } from "@root/modules";
// Domain Modules
import { AnalyticsModule, SyncStorageModule } from "@root/domains";
// Interceptors
import { ResponseSerializerInterceptor } from "@root/interceptors";
// Utilities
import * as Joi from "joi";
import { envConfigLoader } from "@root/utils";
// Enums & Constants
import { APP_INTERCEPTOR } from "@nestjs/core";
import { AdminModule } from "./domains/admin/admin.module";
// Types
import type { MiddlewareConsumer, NestModule } from "@nestjs/common";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [envConfigLoader],
      expandVariables: true,
      envFilePath: [
        `.env.${process.env.NODE_ENV}.local`,
        `.env.${process.env.NODE_ENV}`,
        `.env.local`,
        `.env`,
      ],
      validationSchema: Joi.object({
        // Environment
        NODE_ENV: Joi.string().valid("development", "production", "test").default("development"),
        PORT: Joi.number().port().default(3000),
        API_URL: Joi.string().uri().default("http://localhost:3000").required(),

        DATABASE_URL: Joi.string()
          .pattern(/^mongodb(?:\+srv)?:\/\//)
          .required(),

        // Redis
        REDIS_URL: Joi.string().uri().optional(),
        REDIS_HOST: Joi.string().default("localhost"),
        REDIS_PORT: Joi.number().port().default(6379),
        REDIS_DB: Joi.number().default(0),
        REDIS_PASSWORD: Joi.string().optional().allow(""),

        // JWT
        JWT_SECRET: Joi.string().required(),
        JWT_EXPIRES_IN: Joi.string().default("7d"),

        // API Keys
        API_KEYS_ENABLED: Joi.boolean().default(true),
        API_KEY_TOKEN_PREFIX: Joi.string().default("usex_"),
        API_KEY_DEFAULT_SCOPES: Joi.string().default("read,write"),
        API_KEY_DEFAULT_ENVIRONMENT: Joi.string().default("development"),
        API_KEY_EXPIRATION_DAYS: Joi.number().default(365),

        // Security
        BCRYPT_SALT_ROUNDS: Joi.number().default(12),
        RATE_LIMIT_WINDOW_MS: Joi.number().default(900000), // 15 minutes
        RATE_LIMIT_MAX_REQUESTS: Joi.number().default(100),
        CSRF_SECRET: Joi.string()
          .min(32)
          .required()
          .description("Secret key for CSRF token generation"),

        // CORS
        CORS_ALLOWED_ORIGINS: Joi.string().default("*"),

        // Logging
        LOG_LEVEL: Joi.string()
          .valid("error", "warn", "info", "debug", "verbose", "fatal")
          .default("info"),
        LOG_FORMAT: Joi.string().valid("json", "pretty").default("json"),
        LOG_SILENT: Joi.boolean().default(false),
        LOG_COLORIZE: Joi.string().valid("message", "level", "all").optional(),

        // File Upload
        MAX_FILE_SIZE: Joi.number().default(10485760), // 10MB
        UPLOAD_DESTINATION: Joi.string().default("./uploads"),

        // Email (optional)
        SMTP_HOST: Joi.string().optional(),
        SMTP_PORT: Joi.number().default(587),
        SMTP_SECURE: Joi.boolean().default(false),
        SMTP_USER: Joi.string().optional(),
        SMTP_PASS: Joi.string().optional(),
      }),
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    ContextModule,
    SyncStorageModule,
    AnalyticsModule,
    AdminModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseSerializerInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // @ts-ignore
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    consumer;
    // consumer.apply(ApiLoggerMiddleware).forRoutes("*path");
  }
}
