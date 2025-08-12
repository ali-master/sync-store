import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from "@nestjs/common";
import { Observable } from "rxjs";
import { tap, catchError } from "rxjs/operators";
import { Request } from "express";
import { ApiKeyQuotaService } from "../services/api-key-quota.service";

@Injectable()
export class ApiKeyMetricsInterceptor implements NestInterceptor {
  constructor(private readonly apiKeyQuotaService: ApiKeyQuotaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = (request as any).apiKey;
    const startTime = Date.now();

    if (!apiKey) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(() => {
        // Success - record performance metrics
        const responseTime = Date.now() - startTime;
        this.apiKeyQuotaService
          .updatePerformanceMetrics(apiKey.id, responseTime)
          .catch((error) => console.error("Failed to update performance metrics:", error));
      }),
      catchError((error) => {
        // Error - record failure
        const responseTime = Date.now() - startTime;
        this.apiKeyQuotaService
          .recordFailure(apiKey.id, error.message || "Unknown error")
          .catch((err) => console.error("Failed to record API key failure:", err));

        // Update performance metrics even on error
        this.apiKeyQuotaService
          .updatePerformanceMetrics(apiKey.id, responseTime)
          .catch((err) => console.error("Failed to update performance metrics:", err));

        throw error;
      }),
    );
  }
}
