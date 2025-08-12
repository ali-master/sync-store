import { applyDecorators, UseGuards, UseInterceptors } from "@nestjs/common";
import { ApiSecurity } from "@nestjs/swagger";
import { ApiKeyGuard } from "../guards/api-key.guard";
import { ApiKeyMetricsInterceptor } from "../interceptors/api-key-metrics.interceptor";

/**
 * Applies API key authentication with comprehensive restrictions and monitoring
 *
 * Features:
 * - Domain, IP, and country-based restrictions
 * - User limits per IP/domain
 * - Storage key pattern matching (wildcards supported)
 * - Rate limiting and quotas
 * - Performance monitoring
 * - Security violation tracking
 */
export function ApiKeyAuth() {
  return applyDecorators(
    UseGuards(ApiKeyGuard),
    UseInterceptors(ApiKeyMetricsInterceptor),
    ApiSecurity("api-key"),
    ApiSecurity("user-id"),
    ApiSecurity("instance-id"),
  );
}
