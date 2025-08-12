// Utilities
import { getKeys } from "../object.util";
// Types
import type { Dictionary } from "../../types";

export type LogLevel = "error" | "warn" | "debug" | "verbose" | "fatal" | "info" | "notice";

export const BASE_LOG_LEVELS: Dictionary<LogLevel, number> = {
  fatal: 0,
  error: 1,
  warn: 2,
  notice: 3, // formerly 'log'
  info: 4,
  debug: 5,
  verbose: 6,
};
export const LOG_LEVELS = getKeys(BASE_LOG_LEVELS);
export const DEFAULT_LOG_LEVEL = process.env.NODE_ENV === "development" ? "debug" : "info";
