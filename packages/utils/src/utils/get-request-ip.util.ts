import { findRequestClientIP } from "./ip/ip";
import { getClientIp } from "@supercharge/request-ip";

export function getRequestIP(req: any) {
  return (
    findRequestClientIP(req, {
      platform: "cloudflare",
    }) || getClientIp(req)!
  );
}
