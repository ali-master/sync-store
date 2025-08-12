// Utilities
import { applyDecorators, Header } from "@nestjs/common";

export function NoCors() {
  return applyDecorators(
    Header("Access-Control-Allow-Origin", "*"),
    Header("Access-Control-Allow-Credentials", "true"),
    Header("Access-Control-Allow-Private-Network", "true"),
    Header("Access-Control-Allow-Unsafe-Redirect", "false"),
    Header(
      "Access-Control-Expose-Headers",
      "Content-Type, Authorization, X-API-KEY, X-Trace-ID, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset",
    ),
    Header("Cross-Origin-Resource-Policy", "cross-origin"),
    Header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-KEY, X-Trace-ID"),
    Header("Access-Control-Allow-Methods", "GET, OPTIONS"),
  );
}
