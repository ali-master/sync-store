import { Injectable, NestMiddleware, Logger } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import { AnalyticsAggregationService } from "../services/analytics-aggregation.service";
import { AnalyticsEventType } from "../types/analytics.types";
import { getRequestIP } from "@usex/utils";

export interface RequestWithAnalytics extends Request {
  analyticsData?: {
    apiKeyId?: string;
    userId?: string;
    instanceId?: string;
    startTime: number;
  };
}

@Injectable()
export class AnalyticsMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AnalyticsMiddleware.name);

  constructor(private readonly analyticsAggregationService: AnalyticsAggregationService) {}

  use = (req: RequestWithAnalytics, res: Response, next: NextFunction) => {
    const startTime = Date.now();

    // Extract analytics data from request headers
    const apiKeyId = req.headers["x-api-key"] as string;
    const userId = req.headers["x-user-id"] as string;
    const instanceId = req.headers["x-instance-id"] as string;
    const userAgent = req.headers["user-agent"] as string;
    const ipAddress = getRequestIP(req);

    // Attach analytics data to request for potential use by controllers
    req.analyticsData = {
      apiKeyId,
      userId,
      instanceId,
      startTime,
    };

    // Override response.end to capture response data
    const originalEnd = res.end;
    const originalSend = res.send;

    let responseSize = 0;
    let responseBody: any = undefined;

    // Capture response data
    res.send = function (data: any) {
      responseBody = data;
      if (data) {
        responseSize = Buffer.isBuffer(data)
          ? data.length
          : Buffer.byteLength(data.toString(), "utf8");
      }
      return originalSend.call(this, data);
    };

    res.end = (chunk?: any) => {
      if (chunk && !responseBody) {
        responseBody = chunk;
        responseSize = Buffer.isBuffer(chunk)
          ? chunk.length
          : Buffer.byteLength(chunk.toString(), "utf8");
      }

      // Calculate response time
      const responseTime = Date.now() - startTime;

      // Determine event type based on the request
      let eventType: AnalyticsEventType = AnalyticsEventType.REQUEST;
      if (req.path.includes("/sync/")) {
        eventType = AnalyticsEventType.SYNC;
      } else if (req.path.includes("/analytics/")) {
        eventType = AnalyticsEventType.REQUEST;
      }

      // Track the analytics event (don't await to avoid blocking response)
      if (this.shouldTrackRequest(req)) {
        setImmediate(async () => {
          try {
            await this.trackAnalyticsEvent({
              type: eventType,
              apiKeyId,
              userId,
              instanceId,
              endpoint: req.path,
              method: req.method,
              statusCode: res.statusCode,
              responseTime,
              responseSize,
              ipAddress,
              userAgent,
              metadata: {
                query: req.query,
                contentType: req.headers["content-type"],
                acceptLanguage: req.headers["accept-language"],
                referer: req.headers["referer"],
                timestamp: new Date().toISOString(),
                responseBody: this.sanitizeResponseBody(responseBody),
                requestSize: this.getRequestSize(req),
              },
            });
          } catch (error) {
            // Log error but don't fail the request
            this.logger.warn("Failed to track analytics event:", error);
          }
        });
      }

      return originalEnd.call(this, chunk);
    };

    next();
  };

  private async trackAnalyticsEvent(eventData: {
    type: AnalyticsEventType;
    apiKeyId?: string;
    userId?: string;
    instanceId?: string;
    endpoint?: string;
    method?: string;
    statusCode?: number;
    responseTime?: number;
    responseSize?: number;
    ipAddress?: string;
    userAgent?: string;
    errorType?: string;
    errorMessage?: string;
    metadata?: Record<string, any>;
  }) {
    try {
      // Only track if we have at least an API key or user ID
      if (!eventData.apiKeyId && !eventData.userId) {
        return;
      }

      // Determine error type if status code indicates an error
      if (eventData.statusCode && eventData.statusCode >= 400) {
        if (eventData.statusCode === 401) {
          eventData.errorType = "authentication_error";
        } else if (eventData.statusCode === 403) {
          eventData.errorType = "authorization_error";
        } else if (eventData.statusCode === 429) {
          eventData.errorType = "rate_limit_error";
        } else if (eventData.statusCode >= 500) {
          eventData.errorType = "server_error";
        } else {
          eventData.errorType = "client_error";
        }
      }

      await this.analyticsAggregationService.trackEvent(eventData);
    } catch (error) {
      this.logger.error("Error tracking analytics event:", error);
    }
  }

  /**
   * Sanitize response body for analytics storage
   */
  private sanitizeResponseBody(responseBody: any): any {
    if (!responseBody) {
      return null;
    }

    // Convert to string if it's a buffer
    let sanitized = responseBody;
    if (Buffer.isBuffer(responseBody)) {
      sanitized = responseBody.toString("utf8");
    }

    // Try to parse as JSON for structured logging
    try {
      if (typeof sanitized === "string") {
        const parsed = JSON.parse(sanitized);

        // Remove sensitive fields from the response
        return this.removeSensitiveFields(parsed);
      }

      if (typeof sanitized === "object") {
        return this.removeSensitiveFields(sanitized);
      }
    } catch (parseError) {
      // If not JSON, truncate long strings
      this.logger.debug("Response body is not valid JSON:", parseError);
      if (typeof sanitized === "string" && sanitized.length > 1000) {
        return sanitized.substring(0, 1000) + "... [truncated]";
      }
    }

    return sanitized;
  }

  /**
   * Remove sensitive fields from response data
   */
  private removeSensitiveFields(data: any): any {
    if (!data || typeof data !== "object") {
      return data;
    }

    const sensitiveFields = [
      "password",
      "token",
      "secret",
      "key",
      "authorization",
      "auth",
      "credential",
      "privateKey",
      "accessToken",
      "refreshToken",
    ];

    const sanitized = { ...data };

    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = "[REDACTED]";
      }
    }

    // Recursively sanitize nested objects
    for (const key in sanitized) {
      if (typeof sanitized[key] === "object" && sanitized[key] !== null) {
        sanitized[key] = this.removeSensitiveFields(sanitized[key]);
      }
    }

    return sanitized;
  }

  /**
   * Calculate request size in bytes
   */
  private getRequestSize(req: RequestWithAnalytics): number {
    const contentLength = req.headers["content-length"];

    if (contentLength) {
      return parseInt(contentLength, 10) || 0;
    }

    // Estimate size based on available data
    let size = 0;

    // Add headers size estimate
    size += JSON.stringify(req.headers).length;

    // Add query parameters size
    if (req.query) {
      size += JSON.stringify(req.query).length;
    }

    // Add URL size
    if (req.url) {
      size += req.url.length;
    }

    // Add method size
    if (req.method) {
      size += req.method.length;
    }

    return size;
  }

  /**
   * Determine if the request should be tracked
   */
  private shouldTrackRequest(req: RequestWithAnalytics): boolean {
    // Skip health check endpoints
    if (req.path === "/health" || req.path === "/ping") {
      return false;
    }

    // Skip favicon requests
    if (req.path === "/favicon.ico") {
      return false;
    }

    // Skip static asset requests
    if (req.path.match(/\.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/)) {
      return false;
    }

    // Only track requests with API keys or user IDs
    const hasApiKey = !!req.headers["x-api-key"];
    const hasUserId = !!req.headers["x-user-id"];

    return hasApiKey || hasUserId;
  }
}
