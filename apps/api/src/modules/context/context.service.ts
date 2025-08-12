// Decorators
import { Injectable } from "@nestjs/common";
// Services
import { ClsService } from "nestjs-cls";
// Types
import type { AppContext } from "@root/modules/context/context.type";

/**
 * The AppContextService class provides a structured way to store and retrieve
 * contextual data (e.g., metadata, user info, device info) throughout a request lifecycle.
 * By using `nestjs-cls`, we maintain a shared context accessible from any part of the code
 * during the request.
 *
 * @template T - The type of the data payload stored in the context.
 */
@Injectable()
export class ContextService<T = any> {
  constructor(private readonly cls: ClsService<AppContext<T>>) {}

  /**
   * Retrieves the primary payload object stored under 'payload'.
   * Typically includes core request data.
   */
  getPayload() {
    return this.cls.get("payload");
  }

  /**
   * Retrieves the 'requestId', indicating the global trace identifier
   * used for linking multiple operations in distributed tracing.
   */
  getTraceId() {
    return this.cls.get("requestId");
  }

  /**
   * Returns general device information (e.g., OS, model),
   * stored under 'metadata.device'.
   */
  getDevice() {
    return this.cls.get("device");
  }

  /**
   * Fingerprint refers to a unique device identifier that can be recognized
   * for future requests, stored under 'metadata.fingerprint'.
   */
  getFingerprint() {
    return this.cls.get("fingerprint");
  }

  /**
   * Returns the current IP address from 'metadata.ip'.
   * Can reflect the original client IP or be set by upstream proxies.
   */
  getIp() {
    return this.cls.get("ip");
  }

  /**
   * Returns a Cloudflare-forwarded IP address from 'metadata.ipCf'
   * if Cloudflare proxies are in use.
   */
  getIpCf() {
    return this.cls.get("ipCf");
  }

  /**
   * Retrieves the 'loginIp', reflecting the address used
   * by the client when they originally signed in.
   */
  getLoginIp() {
    return this.cls.get("loginIp");
  }

  /**
   * Retrieves the HTTP request object from the context,
   * which may contain headers, body, and other request-specific data.
   */
  getHttpRequest() {
    return this.cls.get("http");
  }
}
