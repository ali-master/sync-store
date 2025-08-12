// Utilities
import {
  getHeader,
  getRequestIP,
  getRequestDeviceInfo,
  getIpCountryFlagEmoji,
  getRequestIpCountryFlag,
} from "@usex/utils";
import { createRequestFingerprint } from "@root/utils";
// Types
import type { ClsService } from "nestjs-cls";
import type { ExecutionContext } from "@nestjs/common";

export async function assignMetadata(
  cls: ClsService,
  context: ExecutionContext,
  fromGuard = false,
) {
  const request = fromGuard ? context : context.switchToHttp().getRequest();
  if (request.url.includes("api/v1/metrics") || request.url.includes("api/v1/health-check")) {
    return {};
  }

  let accessToken = getHeader(request.headers, "authorization");
  if (accessToken && accessToken.startsWith("Bearer ")) {
    accessToken = accessToken.substring(7);
  }

  // API Key
  const apiKey = getHeader(request.headers, "x-api-key") || getHeader(request.headers, "api-key");
  const instanceId =
    getHeader(request.headers, "x-instance-id") || getHeader(request.headers, "instance-id");
  const userId = getHeader(request.headers, "x-user-id") || getHeader(request.headers, "user-id");

  const requestId = cls.getId();
  const userAgent = request.headers["user-agent"] || "unknown";
  const device = getRequestDeviceInfo(request.headers);
  const ip = getRequestIP(request);
  const ipCf = getRequestIpCountryFlag(request) || "unknown";
  const ipCfEmoji = getIpCountryFlagEmoji(ipCf) || "unknown";
  const baseURL = new URL(`${request.protocol}://${request.host}${request.url}`);
  const fingerprint = (await createRequestFingerprint(request)) ?? null;
  const referrer = getHeader(request.headers, "referrer") || getHeader(request.headers, "referer");
  const fullLink = new URL(`${request.protocol}://${request.headers.host}${request.originalUrl}`);
  const utm = {
    source: fullLink.searchParams.get("utm_source"),
    medium: fullLink.searchParams.get("utm_medium"),
    campaign: fullLink.searchParams.get("utm_campaign"),
    term: fullLink.searchParams.get("utm_term"),
    content: fullLink.searchParams.get("utm_content"),
  };

  const http = {
    host: request.headers.host,
    // Path with no query string
    path: baseURL.pathname,
    method: request.method,
    body: request.body,
    query: request.query,
    headers: request.headers,
    utm,
    referrer,
  };

  cls.set("http", http);
  cls.set("device", { ...(device ?? {}), userAgent });
  cls.set("ip", ip);
  cls.set("ipCf", ipCf);
  cls.set("ipCfEmoji", ipCfEmoji);
  cls.set("fingerprint", fingerprint);
  cls.set("requestId", requestId);
  cls.set("payload", request.body);
  cls.set("apiKey", apiKey);
  cls.set("instanceId", instanceId);
  cls.set("userId", userId);

  // Set new request context fields
  cls.set("userAgent", userAgent);
  cls.set("origin", request.headers["origin"] || "");
  cls.set("referer", referrer || "");
  cls.set("endpoint", request.originalUrl || request.url || "");
  cls.set(
    "isHttps",
    request.protocol === "https" || request.headers["x-forwarded-proto"] === "https",
  );
  cls.set("timestamp", new Date().toISOString());
}
