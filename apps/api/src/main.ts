import "reflect-metadata";
// Modules
import { AppModule } from "@root/app.module";
// Filters
import { GlobalExceptionFilter } from "@root/filters";
// Interceptors
import { getHeader, SystemLogger } from "@usex/utils";
// Utilities
import helmet from "helmet";
import killPort from "kill-port";
import { NestFactory } from "@nestjs/core";
import { ClsMiddleware } from "nestjs-cls";
import compression from "@fastify/compress";
import { ConfigService } from "@nestjs/config";
import { useContainer } from "class-validator";
import { Logger, ValidationPipe } from "@nestjs/common";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { assignMetadata } from "@root/utils/assign-metadata.util";
import { helmetConfig, initSwagger, validationPipeOptions } from "@root/utils";
import { createUniqueId, setNodeProcessTitle, setupSignals } from "@usex/utils";
// Constants
import { TRACE_ID_TOKEN_HEADER } from "@root/constants";
// Enums
import { HttpStatus, VersioningType } from "@nestjs/common";
// Types
import type { FastifyRequest } from "fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

process.on("warning", (warning): void => {
  const ignoredWarnings: Set<string> = new Set([
    "ExperimentalWarning",
    "DeprecationWarning",
    "Warning",
    "UnhandledPromiseRejectionWarning",
    "MaxListenersExceededWarning",
    "TimeoutNegativeWarning",
  ]);

  if (!ignoredWarnings.has(warning.name)) {
    // Only log warnings not in the ignored set
    console.warn(warning.name, warning.message);
  }
});

async function bootstrap() {
  try {
    const fastifyAdapter = new FastifyAdapter({
      ignoreDuplicateSlashes: true,
      ignoreTrailingSlash: true,
      maxParamLength: 500,
      caseSensitive: true,
      return503OnClosing: true,
      forceCloseConnections: "idle",
      allowUnsafeRegex: false,
      requestTimeout: 60000,
      requestIdHeader: TRACE_ID_TOKEN_HEADER,
      requestIdLogLabel: "requestId",
      trustProxy: true,
      genReqId(req: any) {
        return getHeader(req.headers, TRACE_ID_TOKEN_HEADER) as string;
      },
    });

    const app = await NestFactory.create<NestFastifyApplication>(AppModule, fastifyAdapter, {
      bodyParser: true,
      abortOnError: false,
      bufferLogs: true,
      forceCloseConnections: false,
      autoFlushLogs: true,
      logger: SystemLogger("Sync-Store", {
        forceConsole: false,
      }),
    });
    app.enableShutdownHooks();
    app.flushLogs();

    const logger = new Logger("Bootstrap");
    const configService = app.get(ConfigService);

    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: "1",
    });
    app.enableCors({
      origin: "*",
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-API-KEY",
        "X-API-KEY-SCOPE",
        "X-Requested-With",
        "X-User-Id",
        "X-Instance-Id",
      ],
      exposedHeaders: [
        "Content-Type",
        "Authorization",
        "X-API-KEY",
        "X-API-KEY-SCOPE",
        "X-Requested-With",
        "X-User-Id",
        "X-Instance-Id",
      ],
      credentials: true,
      maxAge: 3600,
    });

    useContainer(app.select(AppModule), { fallbackOnErrors: true });

    const fastify = app.getHttpAdapter().getInstance();
    fastify
      .addHook("onError", (_, reply) => {
        reply.status(500).header("content-type", "application/json").send({
          message: "Internal Server Error",
          status: HttpStatus.INTERNAL_SERVER_ERROR,
        });
      })
      .addHook("onRequest", async (_, reply) => {
        // Set CORS headers for private network access
        // This is necessary for browsers to allow requests from private networks
        // See: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Allow-Private-Network
        reply.header("Access-Control-Allow-Private-Network", "true");
      });

    app.use(
      new ClsMiddleware({
        saveReq: true,
        saveRes: true,
        generateId: true,
        idGenerator: (req: FastifyRequest) => {
          const requestId = (req.headers[TRACE_ID_TOKEN_HEADER] as string) ?? createUniqueId();
          req.headers[TRACE_ID_TOKEN_HEADER] = requestId;

          return requestId;
        },
        async setup(cls, context) {
          await assignMetadata(cls, context, true);
        },
      }).use,
    );

    // Temporarily disable compression to fix Swagger UI Content-Length mismatch
    // @ts-expect-error
    await app.register(compression, {
      encodings: ["br", "gzip", "deflate"],
      requestEncodings: ["br", "gzip", "deflate"],
      threshold: 1024,
      inflateIfDeflated: false,
      removeContentLengthHeader: true,
      global: false,
      customTypes: /^(application\/(json|xml)|text\/(plain|html))$/,
      zlibOptions: {
        level: 6,
      },
    });

    // Set global prefix
    app.setGlobalPrefix("api");

    // Use global exception filter
    app.useGlobalFilters(new GlobalExceptionFilter());

    // Enable validation pipes
    app.useGlobalPipes(new ValidationPipe(validationPipeOptions));

    // Enable Helmet for security headers
    app.use(helmet(helmetConfig));

    setupSignals(logger, async () => {
      app.flushLogs();

      if (configService.get<boolean>("env.isProduction")) {
        await app.close();

        process.exit(0);
      } else {
        await app.close();
      }
    });

    process
      .on("uncaughtException", (error: Error) => {
        logger.error(`uncaughtException: ${error.message}`, error.stack ?? "");
      })
      .on("unhandledRejection", (reason, promise) => {
        logger.fatal(`Unhandled Rejection for reason: ${reason}`);

        promise.catch(() => {
          process.exit(0);
        });
      });

    initSwagger(app);

    // Start the server
    const port = configService.get<number>("port") || 3000;
    logger.log(`Starting application on port ${port}...`);
    try {
      await killPort(port);
    } catch (error) {
      logger.error(`Failed to start application on port ${port}:`, error);
    } finally {
      await app.listen(port, "0.0.0.0");
    }

    setNodeProcessTitle(process.cwd(), {
      port,
      customTitle: "Sync-Store API",
    });

    const appUrl = await app.getUrl();
    logger.log(`Application is running on: ${appUrl}/api/v1`);
    logger.log(`Swagger documentation is available at: ${appUrl}/api/docs`);
    logger.log(`Swagger JSON: ${appUrl}/api/docs/openapi.json`);
    logger.log(`Swagger YAML: ${appUrl}/api/docs/openapi.yaml`);
  } catch (e) {
    console.error("Error starting the application:", e);
  }
}

void bootstrap();
