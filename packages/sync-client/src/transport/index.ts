/**
 * Transport layer module for sync-client
 *
 * This module provides a flexible and robust communication layer that supports
 * both WebSocket and HTTP REST protocols with intelligent fallback mechanisms.
 *
 * @module transport
 */

export { TransportFactory, createTransport } from "./transport-factory";
export { HttpTransport } from "./http-transport";
export { WebSocketTransport } from "./websocket-transport";
export { AutoTransport } from "./auto-transport";
export { BaseTransport } from "./base-transport";

export type {
  ITransport,
  TransportConfig,
  TransportResponse,
  TransportEvents,
  TransportMetrics,
  StorageInfo,
} from "./types";

export { TransportMode, TransportState } from "./types";
