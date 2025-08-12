import { LoggerService } from "@nestjs/common";
import { format as formats, transports as winstonTransporters } from "winston";
import { WinstonModule, utilities as nestWinstonModuleUtilities } from "nest-winston";
// Constants
import { LOG_LEVELS, BASE_LOG_LEVELS, DEFAULT_LOG_LEVEL } from "./levels.logger";
// Types
import type { LogLevel } from "./levels.logger";

/**
 * System Logger for the microservices. This will be used to log the system logs.
 * @param app The name of the application. This will be used to identify the logs.
 * @param options The options for the logger. This will be used to customize the logger.
 * @constructor
 */
export const SystemLogger = (app: string, options: LoggerOptions = {}): LoggerService => {
  if (!app) {
    throw new Error(`[SystemLogger] "app" param is required`);
  }

  const isDev = process.env.NODE_ENV === "development";
  const presetIsSilent = process.env.LOG_SILENT?.toLowerCase() === "true";
  const presetLogLevel = process.env.LOG_LEVEL as LogLevel | undefined;
  /**
   * If the colorize option is set, it will colorize the logs based on the level.
   * This will only work if the output is not in JSON format.
   */
  const presetLogColorize = process.env.LOG_COLORIZE as "message" | "level" | "all" | undefined;

  if (presetLogLevel && !LOG_LEVELS.includes(presetLogLevel)) {
    throw new Error(`[SystemLogger] Invalid log level: ${presetLogLevel}`);
  }

  const level = presetLogLevel ?? options.level ?? DEFAULT_LOG_LEVEL;
  const forceConsole = options.forceConsole ?? false;
  /**
   * Formatter for the logger output based on the environment. In development, it will be more human-readable.
   * In production, it will be in JSON format.
   */
  const mainFormatter = isDev
    ? nestWinstonModuleUtilities.format.nestLike(app, {
        colors: true,
        appName: true,
        processId: true,
        prettyPrint: true,
      })
    : formats.json({
        bigint: true,
        circularValue: "[Circular]",
        deterministic: true,
      });
  // Combine the formatters based on the environment.
  const formatters = [
    formats.splat(),
    formats.errors({
      stack: false,
    }),
    formats.timestamp(),
    mainFormatter,
  ];
  if (!isDev && presetLogColorize) {
    // If the colorize option is set, it will colorize the logs based on the level.
    formatters.push(
      formats.colorize({
        all: presetLogColorize === "all",
        message: presetLogColorize === "message",
        level: presetLogColorize === "level",
      }),
    );
  }
  const format = formats.combine(...formatters);
  /**
   * Implement Protection Guard for the sensitive data in the logs.
   * !!! DO NOT REMOVE THIS !!!
   * This is to prevent sensitive data from being logged.
   */
  // Will be implemented in the future
  /**
   * Transports for the logger. In this case, it will log to the console.
   */
  const transports = [
    new winstonTransporters.Console({
      forceConsole,
      handleExceptions: true,
      handleRejections: true,
      consoleWarnLevels: ["warn"],
      stderrLevels: ["error", "fatal"],
    }),
  ];

  return WinstonModule.createLogger({
    format,
    transports,
    exitOnError: false,
    level: level as string,
    levels: BASE_LOG_LEVELS,
    handleExceptions: true,
    handleRejections: true,
    silent: presetIsSilent,
    defaultMeta: {
      app: app.toLowerCase(),
    },
  });
};

export type LoggerOptions = {
  /**
   * The log level for the logger. Default is "info" in production.
   * If the development was detected, the default will be "debug".
   *
   * @default "debug" in development, "info" in production
   */
  level?: LogLevel;

  /**
   * To make the transport log use `console.log()`, `console.warn()` and `console.error()` instead, set the forceConsole option to `true`
   *
   * @default false
   */
  forceConsole?: boolean;

  /**
   * To silent the logger, set the silent option to `true`
   * This will prevent the logger from logging anything.
   *
   * @default false
   */
  silent?: boolean;
};
