// Utilities
import { isArray, isFunction } from "../type-guards";
// Types
import type { HeaderLike } from "./types";

export function getHeader(headers: HeaderLike["headers"], headerKey: string) {
  if (isHeaders(headers)) {
    return headers.get(headerKey) as string | null;
  } else {
    const headerValue = headers[headerKey];
    if (isArray(headerValue)) {
      return headerValue.join(",");
    } else {
      return headerValue as string | null;
    }
  }
}

function isHeaders(val: HeaderLike["headers"]): val is Headers {
  return isFunction(val?.get);
}
