// Utilities
import { getHeader } from "./utils";
// Types
import type { Platform, RequestLike } from "./types";

/**
 * Get the country flag from the request headers.
 * This function is used to get the country flag from the request headers.
 * It is used in the following platforms:
 * - Cloudflare
 * - ArvanCloud
 * - Vercel
 * - Fly.io
 *
 * @param request - The request object to get the country flag from.
 * @param platform - The platform to get the country flag from. If not provided, it will try to get the country flag from all platforms.
 */
export function getRequestIpCountryFlag(request: RequestLike, platform?: Platform): string | null {
  if (platform === "cloudflare") {
    if (getHeader(request.headers, "cf-ipcountry")) {
      return getHeader(request.headers, "cf-ipcountry");
    }
  }

  if (platform === "arvancloud") {
    if (getHeader(request.headers, "ar-real-country")) {
      return getHeader(request.headers, "ar-real-country");
    }

    if (getHeader(request.headers, "x-country-code")) {
      return getHeader(request.headers, "x-country-code");
    }
  }

  if (platform === "vercel") {
    if (getHeader(request.headers, "x-vercel-ip-country")) {
      return getHeader(request.headers, "x-vercel-ip-country");
    }
  }

  if (platform === "fly-io") {
    if (getHeader(request.headers, "fly-region")) {
      return getHeader(request.headers, "fly-region");
    }
  }

  return null;
}

/**
 * Unicode characters for emoji flags start at this number, and run up to 127469.
 */
export const EMOJI_FLAG_UNICODE_STARTING_POSITION = 127397;

/**
 * Converts the 2 digit countryCode into a flag emoji by adding the current character value to the emoji flag unicode starting position. See [Country Code to Flag Emoji](https://dev.to/jorik/country-code-to-flag-emoji-a21) by Jorik Tangelder.
 *
 * @param countryCode The country code returned by: `getRequestIpCountryFlag(request)`.
 * @returns A flag emoji or undefined.
 */
export function getIpCountryFlagEmoji(countryCode: string | undefined): string | undefined {
  const regex = new RegExp("^[A-Z]{2}$").test(countryCode!);
  if (!countryCode || !regex) return undefined;

  return String.fromCodePoint(
    ...countryCode
      .split("")
      .map((char) => EMOJI_FLAG_UNICODE_STARTING_POSITION + char.charCodeAt(0)),
  );
}
