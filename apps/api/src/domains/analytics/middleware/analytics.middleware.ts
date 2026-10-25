import { Injectable, NestMiddleware, Logger } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import { AnalyticsAggregationService } from "../services/analytics-aggregation.service";
import { AnalyticsEventType } from "../types/analytics.types";

export interface RequestWithAnalytics extends Request {
  apiKey?: { id: string };
}

/** Observe completed requests without copying credentials or customer payloads. */
@Injectable()
export class AnalyticsMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AnalyticsMiddleware.name);

  constructor(private readonly analyticsAggregationService: AnalyticsAggregationService) {}

  /** Record metadata only after authentication and response completion. */
  use(req: RequestWithAnalytics, res: Response, next: NextFunction) {
    const startTime = Date.now();
    res.once("finish", () => {
      if (!req.apiKey?.id) return;
      void this.analyticsAggregationService
        .trackEvent({
          type: req.path.includes("/sync/") ? AnalyticsEventType.SYNC : AnalyticsEventType.REQUEST,
          apiKeyId: req.apiKey.id,
          method: req.method,
          statusCode: res.statusCode,
          responseTime: Date.now() - startTime,
        })
        .catch(() => this.logger.warn("Failed to track analytics event"));
    });
    next();
  }
}
