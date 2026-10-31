// Transport layer exports
export {
  TransportFactory,
  createTransport,
  HttpTransport,
  WebSocketTransport,
  AutoTransport,
  TransportMode,
  TransportState,
} from "./transport";
export type {
  ITransport,
  TransportConfig,
  TransportResponse,
  TransportEvents,
  TransportMetrics,
  StorageInfo,
} from "./transport";

export {
  Logger,
  LogLevel,
  LogColors,
  ColoredConsoleOutput,
  ConsoleOutput,
  SessionStorageOutput,
  createLogger,
  setLogLevel,
  addLogOutput,
  configureLogger,
  getLogMetrics,
} from "./utils/logger";
export type { LogEntry, LogOutput, LogFormatter } from "./utils/logger";

// Performance monitoring exports
export {
  PerformanceMonitor,
  globalPerformanceMonitor,
  trackPerformance,
} from "./core/performance-monitor";
export type {
  PerformanceMetrics,
  PerformanceStats,
  PerformanceConfig,
} from "./core/performance-monitor";
