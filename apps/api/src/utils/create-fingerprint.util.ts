// Utilities
import crypto from "uncrypto";
import { LRU } from "tiny-lru";
import { getRequestIP, toMillis } from "@usex/utils";
// Types
import type { FastifyRequest } from "fastify";

/**
 * Configuration options for generating a request fingerprint.
 */
export interface RequestFingerprintOptions {
  /**
   * Whether to hash the resulting fingerprint.
   * - `false` will disable hashing and return the raw fingerprint string.
   * - `"SHA-1"` (the default) will produce an SHA-1 hash of the fingerprint string.
   *
   * @default "SHA-1"
   */
  hash?: false | "SHA-1";

  /**
   * Whether to include the client IP in the fingerprint.
   *
   * @default true
   */
  ip?: boolean;

  /**
   * Whether to include the HTTP method (e.g., GET, POST) in the fingerprint.
   *
   * @default false
   */
  method?: boolean;

  /**
   * Whether to include the request path (URL) in the fingerprint.
   *
   * @default false
   */
  path?: boolean;

  /**
   * Whether to include the user-agent header in the fingerprint.
   *
   * @default false
   */
  userAgent?: boolean;
}

const fingerprintCache = new LRU<string>(1_000_000, toMillis("1 hour"));
export async function createRequestFingerprint(
  request: FastifyRequest,
  options: RequestFingerprintOptions = {},
) {
  const fingerprintOptions = {
    hash: options.hash ?? "SHA-1",
    ip: options.ip ?? true,
    method: options.method ?? false,
    userAgent: options.userAgent ?? true,
    path: options.path ?? false,
  };
  // Prepare an array to hold the various pieces of the fingerprint
  const fingerprintData: unknown[] = [];

  // 1) Include IP address if ip is not explicitly set to false.
  if (fingerprintOptions.ip) {
    fingerprintData.push(getRequestIP(request));
  }

  // 2) Include the HTTP method if enabled
  if (fingerprintOptions.method) {
    fingerprintData.push(request.method);
  }

  // 3) Include the path (URL) if enabled
  if (fingerprintOptions.path) {
    fingerprintData.push(request.url);
  }

  // 4) Include the user-agent header if enabled
  if (fingerprintOptions.userAgent) {
    fingerprintData.push(request.headers["user-agent"]);
  }

  // Convert array to a non-empty string
  const fingerprintString = fingerprintData.filter(Boolean).join("|");
  if (!fingerprintString) {
    return null;
  }

  // If hashing is disabled, return the raw string immediately
  if (fingerprintOptions.hash === false) {
    return fingerprintString;
  }

  if (fingerprintCache.has(fingerprintString)) {
    return fingerprintCache.get(fingerprintString);
  }

  // Default to SHA-1 if the user didn't specify otherwise
  const hashAlgorithm = fingerprintOptions.hash ?? "SHA-1";
  const encoded = new TextEncoder().encode(fingerprintString);

  // Compute the hash using the WebCrypto Subtle API
  const buffer = await crypto.subtle.digest(hashAlgorithm, encoded);

  // Convert the hash buffer into a hex string
  const digest = Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Store the hash in the cache
  fingerprintCache.set(fingerprintString, digest);

  return digest;
}
