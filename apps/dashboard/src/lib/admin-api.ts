import { useRef } from "react";

export type AdminRequest = (
  path: string,
  method?: string,
  body?: unknown,
  key?: string,
  signal?: AbortSignal,
) => Promise<any>;

/** Build the admin request helper once per console mount so its calls share one instance id. */
export function useAdminRequest(token: string): AdminRequest {
  const instance = useRef(crypto.randomUUID());

  /** Call only this dashboard's API origin; never persist credentials in web storage. */
  return async function request(path, method = "GET", body, key = token, signal) {
    const response = await fetch("/api/v1/admin/" + path, {
      method,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
      cache: "no-store",
      headers: {
        Authorization: "Bearer " + key,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        "x-user-id": "dashboard",
        "x-instance-id": instance.current,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        typeof data.message === "string"
          ? data.message
          : "Request failed (" + response.status + ")",
      );
    return data.payload;
  };
}
