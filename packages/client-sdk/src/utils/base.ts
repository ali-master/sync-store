/**
 * Generate a unique instance ID
 */
export function generateInstanceId(): string {
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 8);
  const browserInfo = getBrowserInfo();

  return `${browserInfo}_${timestamp}_${randomStr}`;
}

/**
 * Generate a unique ID
 */
export function generateUniqueId(): string {
  return "id_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 15);
}

/**
 * Get browser information for instance ID
 */
function getBrowserInfo(): string {
  if (typeof window === "undefined") {
    return "node";
  }

  const ua = navigator.userAgent.toLowerCase();

  if (ua.includes("chrome")) return "chrome";
  if (ua.includes("firefox")) return "firefox";
  if (ua.includes("safari")) return "safari";
  if (ua.includes("edge")) return "edge";
  if (ua.includes("opera")) return "opera";

  return "browser";
}
